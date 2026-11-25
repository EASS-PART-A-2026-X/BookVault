"""The Pydantic AI agent, driven by TestModel / FunctionModel (no API key, no network)."""

import httpx
import pytest
from pydantic_ai.exceptions import UnexpectedModelBehavior
from pydantic_ai.messages import (
    ModelMessage,
    ModelRequest,
    ModelResponse,
    ToolCallPart,
    ToolReturnPart,
)
from pydantic_ai.models.function import AgentInfo, FunctionModel
from pydantic_ai.models.test import TestModel

from app.agent import VaultDeps, plan_search, search_agent
from app.backend import VaultClient
from app.schemas import Genre, SearchPlan
from tests.conftest import SESSION, FakeBackend, final, plan_model

pytestmark = pytest.mark.anyio


def deps_for(backend: FakeBackend) -> VaultDeps:
    http = httpx.AsyncClient(base_url="http://backend.test", transport=httpx.MockTransport(backend))
    return VaultDeps(VaultClient(http=http, session=SESSION))


async def run(model: object, backend: FakeBackend, question: str = "q") -> SearchPlan:
    return await plan_search(question, deps_for(backend), model, timeout_seconds=5)  # type: ignore[arg-type]


async def test_test_model_calls_the_tool_and_returns_a_typed_plan(backend: FakeBackend) -> None:
    # TestModel calls every tool, then returns output built from custom_output_args.
    model = TestModel(
        custom_output_args={"genre": "Fantasy", "read_status": "unread", "explanation": "Hi."}
    )
    plan = await run(model, backend)
    assert plan == SearchPlan(genre=Genre.FANTASY, read_status="unread", explanation="Hi.")
    assert "/tropes" in backend.paths()  # the tool read the reader's real tropes


async def test_the_question_and_instructions_reach_the_model(backend: FakeBackend) -> None:
    seen: list[ModelMessage] = []

    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        seen.extend(messages)
        assert [t.name for t in info.function_tools] == ["list_my_tropes"]
        return final(info)

    await run(FunctionModel(respond), backend, "cozy fantasy I haven't read")
    request = seen[0]
    assert isinstance(request, ModelRequest)
    assert "cozy fantasy I haven't read" in str(request.parts)
    assert "Genres are exactly" in (request.instructions or "")


async def test_tool_result_is_the_readers_tropes(backend: FakeBackend) -> None:
    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        last = messages[-1].parts[-1]
        if isinstance(last, ToolReturnPart):
            assert last.content == ["chosen one", "cozy", "found family", "quest"]
            return final(info, trope="found family")
        return ModelResponse(parts=[ToolCallPart("list_my_tropes", {})])

    plan = await run(FunctionModel(respond), backend)
    assert plan.trope == "found family"
    assert backend.paths().count("/tropes") == 1  # the validator reused the tool's answer


async def test_trope_spelling_is_snapped_to_the_readers(backend: FakeBackend) -> None:
    plan = await run(plan_model(trope="Found-Family"), backend)
    assert plan.trope == "found family"


async def test_unknown_trope_is_sent_back_with_the_choices(backend: FakeBackend) -> None:
    retries: list[str] = []

    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        last = messages[-1].parts[-1]
        # The validator's ModelRetry comes back as the answer to the output tool call.
        if isinstance(last, ToolReturnPart) and last.tool_name == info.output_tools[0].name:
            retries.append(str(last.content))
            return final(info, trope=None, explanation="You have no dragon books tagged.")
        return final(info, trope="dragons")

    plan = await run(FunctionModel(respond), backend)
    assert plan.trope is None
    assert '"dragons" is not one of the reader\'s tropes' in retries[0]
    assert '"found family"' in retries[0]


async def test_invalid_output_is_retried_then_accepted(backend: FakeBackend) -> None:
    calls = 0

    def respond(messages: list[ModelMessage], info: AgentInfo) -> ModelResponse:
        nonlocal calls
        calls += 1
        if calls == 1:
            return final(info, genre="Poetry", min_rating=9)  # not a genre, rating > 5
        return final(info, genre="Mystery", min_rating=4)

    plan = await run(FunctionModel(respond), backend)
    assert (plan.genre, plan.min_rating, calls) == (Genre.MYSTERY, 4, 2)


async def test_output_that_stays_invalid_raises(backend: FakeBackend) -> None:
    with pytest.raises(UnexpectedModelBehavior):
        await run(plan_model(min_rating=0), backend)


def test_agent_has_no_fixed_model() -> None:
    # The model always comes from AI_MODEL (or a test model), never from code.
    assert search_agent.model is None
