"""Shared fixtures: an app with explicit settings and a fake backend (no network)."""

from collections.abc import Callable, Iterator

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings
from app.main import create_app

BackendHandler = Callable[[httpx.Request], httpx.Response]


def healthy_backend(request: httpx.Request) -> httpx.Response:
    if request.url.path == "/health":
        return httpx.Response(200, json={"status": "ok"})
    return httpx.Response(404, json={"detail": "Not Found"})


def make_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "backend_url": "http://backend.test",
        "ai_model": "test",
        "ai_timeout_seconds": 5.0,
        "backend_timeout_seconds": 1.0,
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


@pytest.fixture
def make_client() -> Iterator[Callable[..., TestClient]]:
    """make_client(backend=handler, **settings) -> a started TestClient."""
    opened: list[TestClient] = []

    def factory(backend: BackendHandler = healthy_backend, **overrides: object) -> TestClient:
        app = create_app(make_settings(**overrides), httpx.MockTransport(backend))
        client = TestClient(app)
        client.__enter__()  # run the lifespan
        opened.append(client)
        return client

    yield factory
    for client in opened:
        client.__exit__(None, None, None)
