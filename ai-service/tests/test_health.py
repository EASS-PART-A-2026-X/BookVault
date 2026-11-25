"""/health: always answers while the process runs and reports AI + backend readiness."""

from collections.abc import Callable

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import ConfigError
from app.main import create_app

MakeClient = Callable[..., TestClient]


def test_health_ready(make_client: MakeClient) -> None:
    response = make_client().get("/health")
    assert response.status_code == 200
    assert response.json() == {
        "status": "ok",
        "ai": "ready",
        "model": "test",
        "detail": None,
        "backend": "ok",
    }


def test_health_without_ai_model(make_client: MakeClient) -> None:
    body = make_client(ai_model=None).get("/health").json()
    assert body["status"] == "ok"
    assert body["ai"] == "not_configured"
    assert body["detail"].startswith("AI is not configured: set AI_MODEL")


def test_health_when_backend_is_down(make_client: MakeClient) -> None:
    def refuse(request: httpx.Request) -> httpx.Response:
        raise httpx.ConnectError("connection refused", request=request)

    response = make_client(backend=refuse).get("/health")
    assert response.status_code == 200
    assert response.json()["backend"] == "unreachable"


def test_health_when_backend_database_is_down(make_client: MakeClient) -> None:
    def db_down(request: httpx.Request) -> httpx.Response:
        return httpx.Response(503, json={"detail": "Database unavailable"})

    assert make_client(backend=db_down).get("/health").json()["backend"] == "unreachable"


def test_invalid_env_fails_at_startup(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.setenv("AI_TIMEOUT_SECONDS", "never")
    with pytest.raises(ConfigError, match="AI_TIMEOUT_SECONDS"), TestClient(create_app()):
        pass  # pragma: no cover
