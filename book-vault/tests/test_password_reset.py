"""Emails on accounts, password reset by email, and changing password / email."""

import re
from collections.abc import Callable
from datetime import timedelta
from pathlib import Path
from typing import Any

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import Engine, create_engine, inspect, select, text, update
from sqlalchemy.orm import Session

from app.auth import (
    EMAIL_TAKEN,
    RESET_EMAILS_PER_HOUR,
    RESET_INVALID,
    RESET_REQUESTED,
    WRONG_PASSWORD,
    _now,
)
from app.mailer import Email, MemoryMailer
from app.migrations import migrate
from app.models import PasswordReset, User
from tests.conftest import DEFAULT_PASSWORD, email_for

MakeClient = Callable[..., TestClient]
NEW_PASSWORD = "a brand new passphrase"


def login(client: TestClient, username: str, password: str) -> int:
    response = client.post("/auth/login", json={"username": username, "password": password})
    return response.status_code


def ask_reset(client: TestClient, email: str) -> Any:
    return client.post("/auth/password-reset", json={"email": email})


def token_from(message: Email) -> str:
    match = re.search(r"/reset-password\?token=([\w-]+)", message.body)
    assert match, message.body
    return match.group(1)


def confirm(client: TestClient, token: str, password: str = NEW_PASSWORD) -> Any:
    return client.post(
        "/auth/password-reset/confirm", json={"token": token, "new_password": password}
    )


# ----------------------------------------------------------------------- Email on accounts


def test_register_stores_email_lower_case_and_returns_it_to_the_owner(
    anon_client: TestClient,
) -> None:
    response = anon_client.post(
        "/auth/register",
        json={"username": "gal", "email": "  Gal@Example.COM ", "password": DEFAULT_PASSWORD},
    )
    assert response.status_code == 201
    assert response.json()["email"] == "gal@example.com"
    assert anon_client.get("/auth/me").json()["email"] == "gal@example.com"


def test_email_must_be_unique_ignoring_case(
    make_client: MakeClient, anon_client: TestClient
) -> None:
    make_client("gal")
    response = anon_client.post(
        "/auth/register",
        json={"username": "other", "email": "GAL@example.com", "password": DEFAULT_PASSWORD},
    )
    assert response.status_code == 409
    assert response.json() == {"detail": EMAIL_TAKEN}


def test_email_is_never_shown_to_other_readers(make_client: MakeClient) -> None:
    make_client("gal")
    other = make_client("mira")
    assert "gal@example.com" not in other.get("/users/gal").text
    assert "gal@example.com" not in other.get("/users", params={"q": "gal"}).text


# --------------------------------------------------------------------- Request a reset


def test_reset_request_emails_a_link(
    make_client: MakeClient, anon_client: TestClient, outbox: MemoryMailer
) -> None:
    make_client("gal")
    response = ask_reset(anon_client, " GAL@example.com ")
    assert response.status_code == 202
    assert response.json() == {"detail": RESET_REQUESTED}

    [message] = outbox.sent
    assert message.to == "gal@example.com"
    assert message.subject == "Reset your Book Vault password"
    assert "http://localhost:8080/reset-password?token=" in message.body
    assert '"gal"' in message.body  # names the account
    assert DEFAULT_PASSWORD not in message.body


def test_unknown_email_gets_the_same_answer_and_no_email(
    anon_client: TestClient, outbox: MemoryMailer
) -> None:
    response = ask_reset(anon_client, "nobody@example.com")
    assert response.status_code == 202
    assert response.json() == {"detail": RESET_REQUESTED}
    assert outbox.sent == []


def test_account_without_email_gets_no_email(
    make_client: MakeClient, anon_client: TestClient, engine: Engine, outbox: MemoryMailer
) -> None:
    """Accounts made before emails existed have none; nothing can be sent to them."""
    make_client("gal")
    with Session(engine) as db:
        db.execute(update(User).values(email=None))
        db.commit()
    assert ask_reset(anon_client, email_for("gal")).status_code == 202
    assert outbox.sent == []


def test_reset_emails_are_limited_per_hour(
    make_client: MakeClient, anon_client: TestClient, outbox: MemoryMailer
) -> None:
    make_client("gal")
    for _ in range(RESET_EMAILS_PER_HOUR + 2):
        response = ask_reset(anon_client, email_for("gal"))
        assert response.status_code == 202
        assert response.json() == {"detail": RESET_REQUESTED}  # no hint that it's limited
    assert len(outbox.sent) == RESET_EMAILS_PER_HOUR


def test_only_a_hash_of_the_token_is_stored(
    make_client: MakeClient, anon_client: TestClient, engine: Engine, outbox: MemoryMailer
) -> None:
    make_client("gal")
    ask_reset(anon_client, email_for("gal"))
    token = token_from(outbox.sent[0])
    with Session(engine) as db:
        stored = db.scalar(select(PasswordReset))
        assert stored is not None
        assert stored.token_hash != token and len(stored.token_hash) == 64
        assert stored.expires_at - stored.created_at == timedelta(minutes=30)


def test_a_failing_mail_server_still_gives_the_same_answer(
    make_client: MakeClient, anon_client: TestClient, caplog: pytest.LogCaptureFixture
) -> None:
    from app.auth import get_mailer

    class Broken:
        def send(self, message: Email) -> None:
            raise ConnectionRefusedError("smtp down")

    make_client("gal")
    # The client's own app: another test file reloads app.main, which makes a new one.
    anon_client.app.dependency_overrides[get_mailer] = Broken  # type: ignore[attr-defined]
    response = ask_reset(anon_client, email_for("gal"))
    assert response.status_code == 202
    assert "could not send email to gal@example.com: ConnectionRefusedError" in caplog.text


@pytest.mark.parametrize("payload", [{}, {"email": ""}, {"email": "x" * 321}])
def test_reset_request_validation(anon_client: TestClient, payload: dict[str, str]) -> None:
    assert ask_reset_raw(anon_client, payload).status_code == 422


def ask_reset_raw(client: TestClient, payload: dict[str, str]) -> Any:
    return client.post("/auth/password-reset", json=payload)


# --------------------------------------------------------------------- Use the link


def test_reset_sets_the_password_and_logs_out_everywhere(
    make_client: MakeClient, anon_client: TestClient, outbox: MemoryMailer
) -> None:
    gal = make_client("gal")
    ask_reset(anon_client, email_for("gal"))

    assert confirm(anon_client, token_from(outbox.sent[0])).status_code == 204
    assert gal.get("/auth/me").status_code == 401  # the old session is gone
    assert login(anon_client, "gal", DEFAULT_PASSWORD) == 401
    assert login(anon_client, "gal", NEW_PASSWORD) == 200


def test_a_link_works_once_and_cancels_the_other_links(
    make_client: MakeClient, anon_client: TestClient, outbox: MemoryMailer
) -> None:
    make_client("gal")
    ask_reset(anon_client, email_for("gal"))
    ask_reset(anon_client, email_for("gal"))
    first, second = (token_from(m) for m in outbox.sent)

    assert confirm(anon_client, first).status_code == 204
    for token in (first, second):
        response = confirm(anon_client, token, "yet another password")
        assert response.status_code == 400
        assert response.json() == {"detail": RESET_INVALID}
    assert login(anon_client, "gal", NEW_PASSWORD) == 200


def test_an_expired_link_is_refused(
    make_client: MakeClient, anon_client: TestClient, engine: Engine, outbox: MemoryMailer
) -> None:
    make_client("gal")
    ask_reset(anon_client, email_for("gal"))
    with Session(engine) as db:
        db.execute(update(PasswordReset).values(expires_at=_now() - timedelta(seconds=1)))
        db.commit()
    response = confirm(anon_client, token_from(outbox.sent[0]))
    assert response.status_code == 400
    assert response.json() == {"detail": RESET_INVALID}
    assert login(anon_client, "gal", DEFAULT_PASSWORD) == 200  # unchanged


def test_expired_links_are_cleaned_up_on_the_next_request(
    make_client: MakeClient, anon_client: TestClient, engine: Engine
) -> None:
    make_client("gal")
    ask_reset(anon_client, email_for("gal"))
    with Session(engine) as db:
        db.execute(update(PasswordReset).values(expires_at=_now() - timedelta(seconds=1)))
        db.commit()
    ask_reset(anon_client, email_for("gal"))
    with Session(engine) as db:
        assert len(db.scalars(select(PasswordReset)).all()) == 1


def test_a_made_up_token_is_refused(anon_client: TestClient) -> None:
    response = confirm(anon_client, "not-a-real-token")
    assert response.status_code == 400
    assert response.json() == {"detail": RESET_INVALID}


@pytest.mark.parametrize(
    ("payload", "field"),
    [
        ({"token": "abc", "new_password": "short"}, "new_password"),
        ({"token": "abc", "new_password": "x" * 129}, "new_password"),
        ({"token": "", "new_password": NEW_PASSWORD}, "token"),
        ({"new_password": NEW_PASSWORD}, "token"),
    ],
)
def test_confirm_validation(anon_client: TestClient, payload: dict[str, str], field: str) -> None:
    response = anon_client.post("/auth/password-reset/confirm", json=payload)
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", field]


# --------------------------------------------------------------------- Change password


def change_password(client: TestClient, current: str, new: str = NEW_PASSWORD) -> Any:
    return client.post("/auth/password", json={"current_password": current, "new_password": new})


def test_change_password_keeps_this_session_and_ends_the_others(
    make_client: MakeClient, anon_client: TestClient
) -> None:
    gal = make_client("gal")
    other_device = TestClient(gal.app)
    assert login(other_device, "gal", DEFAULT_PASSWORD) == 200

    assert change_password(gal, DEFAULT_PASSWORD).status_code == 204
    assert gal.get("/auth/me").status_code == 200
    assert other_device.get("/auth/me").status_code == 401
    assert login(anon_client, "gal", NEW_PASSWORD) == 200


def test_change_password_cancels_reset_links(
    make_client: MakeClient, anon_client: TestClient, outbox: MemoryMailer
) -> None:
    gal = make_client("gal")
    ask_reset(anon_client, email_for("gal"))
    change_password(gal, DEFAULT_PASSWORD)
    assert confirm(anon_client, token_from(outbox.sent[0])).status_code == 400


def test_change_password_needs_the_current_one(make_client: MakeClient) -> None:
    gal = make_client("gal")
    response = change_password(gal, "wrong password")
    assert response.status_code == 400  # not 401: that would log the app out
    assert response.json() == {"detail": WRONG_PASSWORD}
    assert gal.get("/auth/me").status_code == 200


def test_change_password_validation_and_login(
    make_client: MakeClient, anon_client: TestClient
) -> None:
    gal = make_client("gal")
    assert change_password(gal, DEFAULT_PASSWORD, "short").status_code == 422
    assert change_password(anon_client, DEFAULT_PASSWORD).status_code == 401


# ------------------------------------------------------------------------ Change email


def change_email(client: TestClient, email: str, password: str = DEFAULT_PASSWORD) -> Any:
    return client.put("/auth/email", json={"email": email, "current_password": password})


def test_change_email_moves_where_reset_links_go(
    make_client: MakeClient, anon_client: TestClient, outbox: MemoryMailer
) -> None:
    gal = make_client("gal")
    ask_reset(anon_client, email_for("gal"))  # a link sent to the old address...

    response = change_email(gal, " New@Example.com ")
    assert response.status_code == 200
    assert response.json()["email"] == "new@example.com"
    assert confirm(anon_client, token_from(outbox.sent[0])).status_code == 400  # ...is void

    ask_reset(anon_client, email_for("gal"))
    ask_reset(anon_client, "new@example.com")
    assert [m.to for m in outbox.sent] == ["gal@example.com", "new@example.com"]


def test_change_email_needs_the_password(make_client: MakeClient) -> None:
    gal = make_client("gal")
    response = change_email(gal, "new@example.com", "wrong password")
    assert response.status_code == 400
    assert response.json() == {"detail": WRONG_PASSWORD}
    assert gal.get("/auth/me").json()["email"] == "gal@example.com"


def test_change_email_to_one_in_use(make_client: MakeClient) -> None:
    gal = make_client("gal")
    make_client("mira")
    response = change_email(gal, "MIRA@example.com")
    assert response.status_code == 409
    assert response.json() == {"detail": EMAIL_TAKEN}
    assert change_email(gal, "gal@example.com").status_code == 200  # own email: fine


def test_change_email_validation_and_login(
    make_client: MakeClient, anon_client: TestClient
) -> None:
    gal = make_client("gal")
    response = change_email(gal, "not-an-email")
    assert response.status_code == 422
    assert response.json()["detail"][0]["loc"] == ["body", "email"]
    assert change_email(anon_client, "a@example.com").status_code == 401


def test_new_endpoints_are_documented(anon_client: TestClient) -> None:
    paths = anon_client.get("/openapi.json").json()["paths"]
    assert "400" in paths["/auth/password-reset/confirm"]["post"]["responses"]
    assert {"400", "401"} <= set(paths["/auth/password"]["post"]["responses"])
    assert {"400", "401", "409"} <= set(paths["/auth/email"]["put"]["responses"])


# --------------------------------------------------------------------------- Migration


def test_migrate_adds_a_unique_email_column_to_old_users(tmp_path: Path) -> None:
    engine = create_engine(f"sqlite:///{tmp_path / 'old.db'}")
    with engine.begin() as conn:
        conn.execute(
            text(
                "CREATE TABLE users (id INTEGER PRIMARY KEY, username VARCHAR(30) NOT NULL, "
                "display_name VARCHAR(50) NOT NULL, bio VARCHAR(280) NOT NULL, "
                "is_public BOOLEAN NOT NULL, password_hash VARCHAR(255) NOT NULL, "
                "created_at DATETIME NOT NULL)"
            )
        )
        conn.execute(
            text("INSERT INTO users VALUES (1, 'old', 'Old', '', 0, 'x', '2026-10-01 10:00')")
        )

    from app.database import Base

    Base.metadata.create_all(bind=engine)
    assert "users.email" in migrate(engine)
    assert "email" in {c["name"] for c in inspect(engine).get_columns("users")}
    unique = {i["name"]: i["unique"] for i in inspect(engine).get_indexes("users")}
    assert unique["ix_users_email"]
    with engine.connect() as conn:
        assert conn.execute(text("SELECT email FROM users")).scalar() is None
    assert migrate(engine) == []
    engine.dispose()
