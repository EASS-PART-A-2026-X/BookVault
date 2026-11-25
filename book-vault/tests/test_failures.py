"""Failure modes: the API degrades to clear JSON errors instead of crashing.

The database is made unusable in two ways: a real SQLite file that can't be opened
(its directory doesn't exist), and a session that fails mid-request.
"""

from collections.abc import Generator
from pathlib import Path

import pytest
from fastapi.testclient import TestClient
from sqlalchemy import create_engine
from sqlalchemy.orm import Session, sessionmaker

from app.auth import positive_int_env
from app.database import get_db
from app.main import app

UNAVAILABLE = {"detail": "Database unavailable"}


@pytest.fixture
def database_down(client: TestClient, tmp_path: Path) -> Generator[TestClient, None, None]:
    """`client` is logged in; from now on every request gets a database it can't open.
    `client.restore_db()` puts the working test database back."""
    working = app.dependency_overrides[get_db]
    broken = create_engine(f"sqlite:///{tmp_path / 'missing-dir' / 'books.db'}")
    sessions = sessionmaker(bind=broken)

    def broken_db() -> Generator[Session, None, None]:
        db = sessions()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = broken_db
    client.restore_db = lambda: app.dependency_overrides.__setitem__(get_db, working)  # type: ignore[attr-defined]
    yield client


@pytest.mark.parametrize(
    ("method", "path", "body"),
    [
        ("get", "/health", None),
        ("get", "/books", None),
        ("get", "/books/1", None),
        ("post", "/books", {"title": "T", "author": "A", "genre": "Fantasy"}),
        ("get", "/tropes", None),
        ("get", "/auth/me", None),
        ("post", "/auth/login", {"username": "reader", "password": "correct horse battery"}),
        ("post", "/auth/register", {"username": "newbie", "password": "correct horse battery"}),
        ("get", "/users?q=a", None),
        ("get", "/follow-requests", None),
    ],
)
def test_database_down_is_a_json_503_everywhere(
    database_down: TestClient, method: str, path: str, body: object
) -> None:
    response = getattr(database_down, method)(path, **({"json": body} if body else {}))
    assert response.status_code == 503
    assert response.json() == UNAVAILABLE


def test_service_recovers_when_the_database_is_back(database_down: TestClient) -> None:
    assert database_down.get("/books").status_code == 503
    database_down.restore_db()  # type: ignore[attr-defined]
    assert database_down.get("/books").status_code == 200  # same session, no restart


@pytest.mark.parametrize("raw", ["soon", "-1", "0", "1.5"])
def test_invalid_session_days_stops_startup_clearly(
    monkeypatch: pytest.MonkeyPatch, raw: str
) -> None:
    monkeypatch.setenv("SESSION_DAYS", raw)
    with pytest.raises(RuntimeError, match="SESSION_DAYS must be a whole number greater than 0"):
        positive_int_env("SESSION_DAYS", 30)


@pytest.mark.parametrize(("raw", "expected"), [(None, 30), ("", 30), (" 7 ", 7)])
def test_session_days_default_and_value(
    monkeypatch: pytest.MonkeyPatch, raw: str | None, expected: int
) -> None:
    if raw is None:
        monkeypatch.delenv("SESSION_DAYS", raising=False)
    else:
        monkeypatch.setenv("SESSION_DAYS", raw)
    assert positive_int_env("SESSION_DAYS", 30) == expected
