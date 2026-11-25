"""POST /search end to end (fake backend + fake model), above all its failure modes:
every failure is a clear status code and message, never a crash or a leaked detail."""

import asyncio

import httpx
import pytest
from pydantic_ai.exceptions import AgentRunError, ModelHTTPError, ModelTimeoutError
from pydantic_ai.messages import ModelMessage, ModelResponse
from pydantic_ai.models.function import AgentInfo, FunctionModel

from app.main import (
    AI_BAD_OUTPUT,
    AI_PROVIDER_ERROR,
    AI_TIMEOUT,
    BACKEND_UNAVAILABLE,
    NOT_LOGGED_IN,
)
from tests.conftest import FakeBackend, MakeClient, plan_model


def raising(exc: Exception) -> FunctionModel:
    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        raise exc

    return FunctionModel(respond)


def ask(client: object, question: str = "unread fantasy with found family") -> httpx.Response:
    return client.post("/search", json={"question": question})  # type: ignore[attr-defined]


# ---- success -------------------------------------------------------------------


def test_search_returns_the_plan_and_matching_books(make_client: MakeClient) -> None:
    model = plan_model(
        genre="Fantasy", read_status="unread", trope="Found Family", explanation="Cozy picks."
    )
    response = ask(make_client(model=model))
    assert response.status_code == 200
    body = response.json()
    assert body["plan"] == {
        "genre": "Fantasy",
        "read_status": "unread",
        "min_rating": None,
        "trope": "found family",
        "text": None,
        "explanation": "Cozy picks.",
    }
    assert [b["title"] for b in body["books"]] == ["Legends & Lattes"]
    assert "review" not in body["books"][0]


def test_search_by_author_text(make_client: MakeClient) -> None:
    body = ask(make_client(model=plan_model(text="tolkien")), "my Tolkien books").json()
    assert [b["title"] for b in body["books"]] == ["The Hobbit"]


def test_no_matches_is_an_empty_list_not_an_error(make_client: MakeClient) -> None:
    response = ask(make_client(model=plan_model(genre="Historical")))
    assert response.status_code == 200
    assert response.json()["books"] == []


# ---- invalid input (422) -------------------------------------------------------


@pytest.mark.parametrize(
    "payload",
    [{}, {"question": ""}, {"question": "    "}, {"question": "x" * 301}, {"question": 5}],
    ids=["missing", "empty", "blank", "too-long", "not-a-string"],
)
def test_invalid_question_is_422(make_client: MakeClient, payload: dict[str, object]) -> None:
    def must_not_run(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        raise AssertionError("the model must not be called")

    response = make_client(model=FunctionModel(must_not_run)).post("/search", json=payload)
    assert response.status_code == 422


# ---- auth (401) ----------------------------------------------------------------


def test_logged_out_is_401_before_any_model_call(
    make_client: MakeClient, backend: FakeBackend
) -> None:
    response = ask(make_client(model=raising(AssertionError("no model call")), logged_in=False))
    assert response.status_code == 401
    assert response.json() == {"detail": NOT_LOGGED_IN}
    assert backend.requests == []


def test_expired_session_is_401(make_client: MakeClient) -> None:
    client = make_client(model=plan_model(genre="Fantasy"))
    client.cookies.set("bv_session", "expired-token")
    response = ask(client)
    assert response.status_code == 401
    assert response.json() == {"detail": NOT_LOGGED_IN}


# ---- missing configuration (503) -----------------------------------------------


def test_missing_ai_model_is_503_with_the_reason(make_client: MakeClient) -> None:
    response = ask(make_client(ai_model=None))
    assert response.status_code == 503
    assert response.json()["detail"].startswith("AI is not configured: set AI_MODEL")


def test_missing_provider_key_is_503(
    make_client: MakeClient, monkeypatch: pytest.MonkeyPatch
) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    response = ask(make_client(ai_model="anthropic:claude-haiku-5-5"))
    assert response.status_code == 503
    assert "ANTHROPIC_API_KEY" in response.json()["detail"]


# ---- backend / database down (503) ---------------------------------------------


def refuse(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("connection refused", request=request)


def database_down(request: httpx.Request) -> httpx.Response:
    return httpx.Response(503, json={"detail": "Database unavailable"})


@pytest.mark.parametrize("handler", [refuse, database_down], ids=["unreachable", "db-down"])
def test_backend_down_during_the_tool_call_is_503(make_client: MakeClient, handler: object) -> None:
    response = ask(make_client(backend=handler, model=plan_model(trope="cozy")))
    assert response.status_code == 503
    assert response.json() == {"detail": BACKEND_UNAVAILABLE}


@pytest.mark.parametrize("handler", [refuse, database_down], ids=["unreachable", "db-down"])
def test_backend_down_when_running_the_search_is_503(
    make_client: MakeClient, handler: object
) -> None:
    response = ask(make_client(backend=handler, model=plan_model(genre="Fantasy")))
    assert response.status_code == 503
    assert response.json() == {"detail": BACKEND_UNAVAILABLE}


# ---- AI provider failures (502 / 504) ------------------------------------------


def test_model_timeout_is_504(make_client: MakeClient) -> None:
    async def slow(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        await asyncio.sleep(5)
        raise AssertionError("unreachable")  # pragma: no cover

    response = ask(make_client(model=FunctionModel(slow), ai_timeout_seconds=0.1))
    assert response.status_code == 504
    assert response.json() == {"detail": AI_TIMEOUT}


def test_provider_timeout_error_is_504(make_client: MakeClient) -> None:
    response = ask(
        make_client(
            model=raising(ModelTimeoutError("anthropic:claude-haiku-5-5", "Request timed out"))
        )
    )
    assert response.status_code == 504


@pytest.mark.parametrize("code", [401, 429, 500, 529])
def test_provider_http_error_is_502_without_leaking_the_body(
    make_client: MakeClient, code: int
) -> None:
    error = ModelHTTPError(code, "anthropic:claude-haiku-5-5", body={"secret": "provider-body"})
    response = ask(make_client(model=raising(error)))
    assert response.status_code == 502
    assert response.json() == {"detail": AI_PROVIDER_ERROR}


def test_any_other_agent_failure_is_502(make_client: MakeClient) -> None:
    response = ask(make_client(model=raising(AgentRunError("something odd"))))
    assert response.status_code == 502
    assert response.json() == {"detail": AI_PROVIDER_ERROR}


def test_unusable_model_output_is_502(make_client: MakeClient) -> None:
    response = ask(make_client(model=plan_model(min_rating=42)))
    assert response.status_code == 502
    assert response.json() == {"detail": AI_BAD_OUTPUT}


def test_runaway_tool_loop_hits_the_usage_limit(make_client: MakeClient) -> None:
    from pydantic_ai.messages import ToolCallPart

    def loop(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        return ModelResponse(parts=[ToolCallPart("list_my_tropes", {})])

    response = ask(make_client(model=FunctionModel(loop)))
    assert response.status_code == 502
    assert response.json() == {"detail": AI_BAD_OUTPUT}


def test_service_keeps_working_after_failures(make_client: MakeClient) -> None:
    client = make_client(model=raising(ModelHTTPError(500, "m")))
    assert ask(client).status_code == 502
    assert client.get("/health").status_code == 200
