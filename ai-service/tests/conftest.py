"""Shared fixtures: the app with explicit settings, a fake backend and a fake model.

No test touches the network or needs an API key: the backend is an
httpx.MockTransport and the model is Pydantic AI's TestModel or FunctionModel.
"""

import os
import time
from collections.abc import Callable, Iterator
from dataclasses import dataclass, field
from typing import Any

os.environ.setdefault("PYDANTIC_AI_NO_BANNER", "1")

import httpx  # noqa: E402
import pytest  # noqa: E402
from fastapi.testclient import TestClient  # noqa: E402
from pydantic_ai.messages import ModelMessage, ModelResponse, ToolCallPart  # noqa: E402
from pydantic_ai.models import Model  # noqa: E402
from pydantic_ai.models.function import AgentInfo, FunctionModel  # noqa: E402

from app.backend import SESSION_COOKIE  # noqa: E402
from app.config import ModelStatus, Settings  # noqa: E402
from app.main import create_app  # noqa: E402

BackendHandler = Callable[[httpx.Request], httpx.Response]

SESSION = "reader-session-token"


def book(
    id: int,
    title: str,
    author: str,
    genre: str,
    *,
    rating: int | None = None,
    is_read: bool = False,
    tropes: list[str] | None = None,
) -> dict[str, Any]:
    return {
        "id": id,
        "title": title,
        "author": author,
        "genre": genre,
        "rating": rating,
        "is_read": is_read,
        "review": None,
        "tropes": tropes or [],
        "created_at": "2026-11-25T10:00:00Z",
        "updated_at": "2026-11-25T10:00:00Z",
    }


DEFAULT_BOOKS = [
    book(
        1,
        "The Hobbit",
        "J.R.R. Tolkien",
        "Fantasy",
        rating=5,
        is_read=True,
        tropes=["found family", "quest"],
    ),
    book(2, "Dune", "Frank Herbert", "Sci-Fi", rating=4, is_read=True, tropes=["chosen one"]),
    book(3, "Legends & Lattes", "Travis Baldree", "Fantasy", tropes=["found family", "cozy"]),
    book(4, "Gone Girl", "Gillian Flynn", "Thriller", rating=3, is_read=True),
]


@dataclass
class FakeBackend:
    """A tiny in-memory stand-in for the Book Vault API (only what the AI service uses)."""

    books: list[dict[str, Any]] = field(default_factory=lambda: list(DEFAULT_BOOKS))
    requests: list[httpx.Request] = field(default_factory=list)

    def __call__(self, request: httpx.Request) -> httpx.Response:
        self.requests.append(request)
        path = request.url.path
        if path == "/health":
            return httpx.Response(200, json={"status": "ok"})
        if request.headers.get("cookie") != f"{SESSION_COOKIE}={SESSION}":
            return httpx.Response(401, json={"detail": "Not authenticated"})
        if path == "/auth/me":
            return httpx.Response(200, json={"id": 1, "username": "reader"})
        if path == "/tropes":
            counts: dict[str, int] = {}
            for item in self.books:
                for trope in item["tropes"]:
                    counts[trope] = counts.get(trope, 0) + 1
            return httpx.Response(
                200, json=[{"name": n, "book_count": c} for n, c in sorted(counts.items())]
            )
        if path == "/books":
            q = request.url.params
            result = [
                b
                for b in self.books
                if ("genre" not in q or b["genre"] == q["genre"])
                and ("is_read" not in q or b["is_read"] == (q["is_read"] == "true"))
                and ("min_rating" not in q or (b["rating"] or 0) >= int(q["min_rating"]))
                and ("trope" not in q or q["trope"] in b["tropes"])
            ]
            return httpx.Response(200, json=result)
        return httpx.Response(404, json={"detail": "Not Found"})

    def paths(self) -> list[str]:
        return [r.url.path for r in self.requests]


@pytest.fixture
def backend() -> FakeBackend:
    return FakeBackend()


def make_settings(**overrides: object) -> Settings:
    values: dict[str, object] = {
        "backend_url": "http://backend.test",
        "ai_model": "test",
        "ai_timeout_seconds": 5.0,
        "backend_timeout_seconds": 1.0,
    }
    values.update(overrides)
    return Settings(**values)  # type: ignore[arg-type]


MakeClient = Callable[..., TestClient]


@pytest.fixture
def make_client(backend: FakeBackend) -> Iterator[MakeClient]:
    """make_client(backend=handler, model=Model, logged_in=True, clock=fn, **settings).

    `model` replaces the model resolved from AI_MODEL (e.g. a FunctionModel)."""
    opened: list[TestClient] = []

    def factory(
        backend: BackendHandler = backend,
        model: Model | None = None,
        logged_in: bool = True,
        clock: Callable[[], float] = time.monotonic,
        **overrides: object,
    ) -> TestClient:
        app = create_app(make_settings(**overrides), httpx.MockTransport(backend), clock)
        client = TestClient(app)
        client.__enter__()  # run the lifespan
        if model is not None:
            app.state.model_status = ModelStatus(model=model, reason=None)
        if logged_in:
            client.cookies.set(SESSION_COOKIE, SESSION)
        opened.append(client)
        return client

    yield factory
    for client in opened:
        client.__exit__(None, None, None)


def final(info: AgentInfo, **plan: Any) -> ModelResponse:
    """A model response that returns `plan` as the agent's SearchPlan output."""
    plan.setdefault("explanation", "Test plan.")
    return ModelResponse(parts=[ToolCallPart(info.output_tools[0].name, plan)])


def plan_model(**plan: Any) -> FunctionModel:
    """A model that immediately answers with this plan (no tool calls)."""

    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return final(info, **plan)

    return FunctionModel(respond)


@pytest.fixture
def anyio_backend() -> str:
    """Async tests run on asyncio via anyio's pytest plugin (already installed)."""
    return "asyncio"
