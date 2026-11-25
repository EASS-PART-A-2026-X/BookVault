"""Accounts, sessions, per-user books, and upgrading databases from before accounts."""

from collections.abc import Callable
from datetime import UTC, datetime, timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, inspect, select, text, update
from sqlalchemy.orm import Session

from app.auth import SESSION_COOKIE
from app.main import app
from app.migrations import migrate
from app.models import AuthSession, User
from tests.conftest import DEFAULT_PASSWORD, email_for

BOOK: dict[str, Any] = {"title": "Dune", "author": "Frank Herbert", "genre": "Sci-Fi"}
MakeClient = Callable[..., TestClient]


def register(client: TestClient, username: str = "gal", **extra: Any) -> Any:
    return client.post(
        "/auth/register",
        json={
            "username": username,
            "email": email_for(username.strip().lower()),
            "password": DEFAULT_PASSWORD,
            **extra,
        },
    )


# --------------------------------------------------------------------- Register


def test_register_creates_account_and_logs_in(anon_client: TestClient) -> None:
    response = register(anon_client, "  Gal_A.1 ", display_name="  Gal A ")
    assert response.status_code == 201
    body = response.json()
    assert body["username"] == "gal_a.1"  # trimmed and lower-cased
    assert body["display_name"] == "Gal A"
    assert body["is_public"] is False and body["bio"] == ""
    assert "password" not in response.text and "hash" not in response.text
    # Logged in straight away.
    assert anon_client.get("/auth/me").json()["username"] == "gal_a.1"


def test_display_name_defaults_to_username(anon_client: TestClient) -> None:
    assert register(anon_client, "reader2").json()["display_name"] == "reader2"


def test_session_cookie_is_httponly_and_samesite(anon_client: TestClient) -> None:
    header = register(anon_client).headers["set-cookie"]
    assert header.startswith(f"{SESSION_COOKIE}=")
    assert "HttpOnly" in header
    assert "SameSite=lax" in header
    assert "Path=/" in header


def test_password_is_stored_hashed(anon_client: TestClient, engine: Engine) -> None:
    register(anon_client)
    with Session(engine) as db:
        user = db.scalar(select(User))
        assert user is not None
        assert DEFAULT_PASSWORD not in user.password_hash
        assert user.password_hash.startswith("$argon2id$")
        # Only a hash of the session token is stored, not the cookie value.
        stored = db.scalar(select(AuthSession.token_hash))
        assert stored != anon_client.cookies.get(SESSION_COOKIE)
        assert stored is not None and len(stored) == 64


def test_username_taken_is_case_insensitive(anon_client: TestClient) -> None:
    register(anon_client, "gal")
    response = register(anon_client, "GAL")
    assert response.status_code == 409
    assert response.json() == {"detail": "Username already taken"}


E = "gal@example.com"


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"username": "ab", "email": E, "password": DEFAULT_PASSWORD}, "username"),
        ({"username": "x" * 31, "email": E, "password": DEFAULT_PASSWORD}, "username"),
        ({"username": "no spaces", "email": E, "password": DEFAULT_PASSWORD}, "username"),
        ({"username": "émile", "email": E, "password": DEFAULT_PASSWORD}, "username"),
        ({"username": "gal", "email": E, "password": "short"}, "password"),
        ({"username": "gal", "email": E, "password": "x" * 129}, "password"),
        (
            {"username": "gal", "email": E, "password": DEFAULT_PASSWORD, "display_name": "  "},
            "display_name",
        ),
        ({"password": DEFAULT_PASSWORD, "email": E}, "username"),
        ({"username": "gal", "password": DEFAULT_PASSWORD}, "email"),
        ({"username": "gal", "email": "not-an-email", "password": DEFAULT_PASSWORD}, "email"),
        ({"username": "gal", "email": "a b@example.com", "password": DEFAULT_PASSWORD}, "email"),
        ({"username": "gal", "email": "x" * 250 + "@a.io", "password": DEFAULT_PASSWORD}, "email"),
    ],
    ids=[
        "too-short",
        "too-long",
        "space",
        "non-ascii",
        "short-pw",
        "long-pw",
        "blank-name",
        "missing",
        "no-email",
        "bad-email",
        "email-space",
        "long-email",
    ],
)
def test_register_validation(anon_client: TestClient, payload: dict[str, Any], field: str) -> None:
    response = anon_client.post("/auth/register", json=payload)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", field]


# ------------------------------------------------------------------ Login/logout


def test_login_and_logout(make_client: MakeClient, anon_client: TestClient) -> None:
    make_client("gal")
    response = anon_client.post(
        "/auth/login", json={"username": " GAL ", "password": DEFAULT_PASSWORD}
    )
    assert response.status_code == 200
    assert response.json()["username"] == "gal"
    assert anon_client.get("/books").status_code == 200

    assert anon_client.post("/auth/logout").status_code == 204
    assert anon_client.get("/auth/me").status_code == 401


def test_logout_kills_the_session_server_side(client: TestClient) -> None:
    """Even a copy of the cookie stops working after logout."""
    stolen = client.cookies.get(SESSION_COOKIE)
    client.post("/auth/logout")
    client.cookies.set(SESSION_COOKIE, stolen)
    assert client.get("/auth/me").status_code == 401


def test_logout_without_session_is_fine(anon_client: TestClient) -> None:
    assert anon_client.post("/auth/logout").status_code == 204


@pytest.mark.parametrize(
    ("username", "password"), [("gal", "wrong password"), ("nobody", DEFAULT_PASSWORD)]
)
def test_bad_login_gives_the_same_401(
    make_client: MakeClient, anon_client: TestClient, username: str, password: str
) -> None:
    """Wrong password and unknown user look identical, so usernames can't be probed."""
    make_client("gal")
    response = anon_client.post("/auth/login", json={"username": username, "password": password})
    assert response.status_code == 401
    assert response.json() == {"detail": "Invalid username or password"}
    assert SESSION_COOKIE not in response.cookies


def test_login_upgrades_an_outdated_password_hash(
    make_client: MakeClient, anon_client: TestClient, engine: Engine
) -> None:
    """Hashes made with weaker Argon2 settings are re-hashed on the next good login."""
    from argon2 import PasswordHasher

    make_client("gal")
    weak = PasswordHasher(time_cost=1, memory_cost=8192).hash(DEFAULT_PASSWORD)
    with Session(engine) as db:
        db.execute(update(User).values(password_hash=weak))
        db.commit()
    assert (
        anon_client.post(
            "/auth/login", json={"username": "gal", "password": DEFAULT_PASSWORD}
        ).status_code
        == 200
    )
    with Session(engine) as db:
        assert db.scalar(select(User.password_hash)) != weak


def test_expired_session_is_rejected(client: TestClient, engine: Engine) -> None:
    with Session(engine) as db:
        past = datetime.now(UTC).replace(tzinfo=None) - timedelta(seconds=1)
        db.execute(update(AuthSession).values(expires_at=past))
        db.commit()
    assert client.get("/auth/me").status_code == 401


def test_garbage_cookie_is_rejected(anon_client: TestClient) -> None:
    anon_client.cookies.set(SESSION_COOKIE, "not-a-real-token")
    assert anon_client.get("/auth/me").json() == {"detail": "Not authenticated"}


# ---------------------------------------------------------------------- Profile


def test_update_profile(client: TestClient) -> None:
    response = client.patch(
        "/users/me", json={"display_name": " Reader ", "bio": " Loves fantasy. ", "is_public": True}
    )
    assert response.status_code == 200
    me = client.get("/auth/me").json()
    assert (me["display_name"], me["bio"], me["is_public"]) == ("Reader", "Loves fantasy.", True)


def test_update_profile_is_partial(client: TestClient) -> None:
    client.patch("/users/me", json={"bio": "hello"})
    me = client.patch("/users/me", json={"is_public": True}).json()
    assert me["bio"] == "hello" and me["is_public"] is True


@pytest.mark.parametrize(
    "payload",
    [{"display_name": None}, {"display_name": " "}, {"bio": "x" * 281}, {"is_public": None}],
)
def test_update_profile_validation(client: TestClient, payload: dict[str, Any]) -> None:
    assert client.patch("/users/me", json=payload).status_code == 422


# ------------------------------------------------------------ Login is required


@pytest.mark.parametrize(
    ("method", "path"),
    [
        ("get", "/books"),
        ("post", "/books"),
        ("get", "/books/1"),
        ("put", "/books/1"),
        ("delete", "/books/1"),
        ("get", "/tropes"),
        ("get", "/auth/me"),
        ("patch", "/users/me"),
    ],
)
def test_endpoints_require_login(anon_client: TestClient, method: str, path: str) -> None:
    response = anon_client.request(method, path, json=BOOK if method in {"post", "put"} else None)
    assert response.status_code == 401
    assert response.json() == {"detail": "Not authenticated"}


def test_health_stays_public(anon_client: TestClient) -> None:
    assert anon_client.get("/health").status_code == 200


# -------------------------------------------------------------------- Ownership


def test_users_only_see_their_own_books(make_client: MakeClient) -> None:
    alice, bob = make_client("alice"), make_client("bob")
    book = alice.post("/books", json={**BOOK, "tropes": ["chosen one"]}).json()
    bob.post(
        "/books", json={**BOOK, "title": "Emma", "genre": "Romance", "tropes": ["matchmaking"]}
    )

    assert [b["title"] for b in alice.get("/books").json()] == ["Dune"]
    assert [b["title"] for b in bob.get("/books").json()] == ["Emma"]
    assert bob.get("/books", params={"trope": "chosen one"}).json() == []
    # Tropes are counted per user.
    assert alice.get("/tropes").json() == [{"name": "chosen one", "book_count": 1}]
    assert bob.get("/tropes").json() == [{"name": "matchmaking", "book_count": 1}]

    # Someone else's book is "not found", for every action, and stays unchanged.
    for response in (
        bob.get(f"/books/{book['id']}"),
        bob.put(f"/books/{book['id']}", json={"title": "Stolen"}),
        bob.delete(f"/books/{book['id']}"),
    ):
        assert response.status_code == 404
        assert response.json() == {"detail": "Book not found"}
    assert alice.get(f"/books/{book['id']}").json()["title"] == "Dune"


def test_cors_allows_credentials_for_the_dev_origin(client: TestClient) -> None:
    response = client.options(
        "/users/me",
        headers={"Origin": "http://localhost:5173", "Access-Control-Request-Method": "PATCH"},
    )
    assert response.status_code == 200
    assert response.headers["access-control-allow-credentials"] == "true"
    assert "PATCH" in response.headers["access-control-allow-methods"]


# ---------------------------------------------------- Upgrading old databases

OLD_SCHEMA = """
CREATE TABLE books (
    id INTEGER PRIMARY KEY, title VARCHAR(255) NOT NULL, author VARCHAR(255) NOT NULL,
    genre VARCHAR(11) NOT NULL, rating INTEGER, is_read BOOLEAN NOT NULL, review TEXT,
    created_at DATETIME NOT NULL, updated_at DATETIME NOT NULL
);
INSERT INTO books VALUES (1, 'Old Book', 'Someone', 'Mystery', 4, 1, NULL,
                          '2026-10-01 10:00:00', '2026-10-01 10:00:00');
"""


def test_migrate_adds_owner_column_and_is_idempotent(tmp_path: Path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        for statement in OLD_SCHEMA.split(";"):
            if statement.strip():
                conn.execute(text(statement))

    from app.database import Base

    Base.metadata.create_all(bind=engine)  # what the app's startup does first
    assert migrate(engine) == ["books.owner_id"]
    assert "owner_id" in {c["name"] for c in inspect(engine).get_columns("books")}
    assert migrate(engine) == []  # second start: nothing to do
    engine.dispose()


def test_first_account_adopts_books_from_before_accounts(
    tmp_path: Path, monkeypatch: pytest.MonkeyPatch
) -> None:
    """End to end: an EX1-era database file, app startup, then two sign-ups."""
    from sqlalchemy.orm import sessionmaker

    import app.main as main_module
    from app.database import get_db

    engine = create_engine(
        f"sqlite:///{tmp_path / 'old.db'}", connect_args={"check_same_thread": False}
    )
    with engine.begin() as conn:
        for statement in OLD_SCHEMA.split(";"):
            if statement.strip():
                conn.execute(text(statement))
    monkeypatch.setattr(main_module, "engine", engine)  # used by the startup migration
    factory = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db() -> Any:
        db = factory()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    try:
        with TestClient(app) as first, TestClient(app) as second:
            register(first, "owner")
            register(second, "latecomer")
            assert [b["title"] for b in first.get("/books").json()] == ["Old Book"]
            assert second.get("/books").json() == []
    finally:
        app.dependency_overrides.clear()
        engine.dispose()
