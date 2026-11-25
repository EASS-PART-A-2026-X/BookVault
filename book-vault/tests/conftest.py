"""Shared fixtures: every test gets a fresh, isolated in-memory database."""

import os

# Point the app's own engine at an in-memory DB *before* importing app modules,
# so running the tests never creates or touches ./data/books.db.
os.environ.setdefault("DATABASE_URL", "sqlite://")

from collections.abc import Callable, Generator  # noqa: E402

import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from sqlalchemy import Engine, create_engine  # noqa: E402
from sqlalchemy.orm import Session, sessionmaker  # noqa: E402
from sqlalchemy.pool import StaticPool  # noqa: E402

from app.auth import get_mailer  # noqa: E402
from app.database import Base, get_db  # noqa: E402
from app.mailer import MemoryMailer  # noqa: E402
from app.main import app  # noqa: E402

DEFAULT_PASSWORD = "correct horse battery"


def email_for(username: str) -> str:
    return f"{username}@example.com"


@pytest.fixture
def outbox() -> MemoryMailer:
    """Every email the app "sends" in a test lands here; nothing leaves the machine."""
    return MemoryMailer()


@pytest.fixture
def engine(outbox: MemoryMailer) -> Generator[Engine, None, None]:
    # StaticPool reuses a single connection, so every session sees the same
    # in-memory database (otherwise each connection would get an empty one).
    engine = create_engine(
        "sqlite://",
        connect_args={"check_same_thread": False},
        poolclass=StaticPool,
    )
    Base.metadata.create_all(bind=engine)
    testing_session = sessionmaker(bind=engine, autoflush=False, expire_on_commit=False)

    def override_get_db() -> Generator[Session, None, None]:
        db = testing_session()
        try:
            yield db
        finally:
            db.close()

    app.dependency_overrides[get_db] = override_get_db
    app.dependency_overrides[get_mailer] = lambda: outbox
    yield engine
    app.dependency_overrides.clear()
    engine.dispose()


@pytest.fixture
def anon_client(engine: Engine) -> Generator[TestClient, None, None]:
    """A client that is not logged in."""
    with TestClient(app) as test_client:
        yield test_client


@pytest.fixture
def make_client(engine: Engine) -> Generator[Callable[[str], TestClient], None, None]:
    """Factory: make_client("alice") registers alice and returns her logged-in client.
    Each client has its own cookie jar, so several users can act in one test."""
    clients: list[TestClient] = []

    def _make(username: str, password: str = DEFAULT_PASSWORD) -> TestClient:
        test_client = TestClient(app)
        test_client.__enter__()
        clients.append(test_client)
        response = test_client.post(
            "/auth/register",
            json={"username": username, "email": email_for(username), "password": password},
        )
        assert response.status_code == 201, response.text
        return test_client

    yield _make
    for test_client in clients:
        test_client.__exit__(None, None, None)


@pytest.fixture
def client(make_client: Callable[[str], TestClient]) -> TestClient:
    """A logged-in client (user "reader"). The EX1 book tests use this."""
    return make_client("reader")
