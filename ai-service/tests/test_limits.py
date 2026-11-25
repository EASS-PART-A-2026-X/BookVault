"""AI search limits: per reader per minute and per day, and for everyone per day."""

from collections.abc import Callable
from typing import Any

import httpx
import pytest

from app.backend import SESSION_COOKIE, BackendUnavailable, VaultClient
from app.config import ConfigError, load_settings
from app.limits import DAY, MINUTE, LimitExceeded, SearchLimiter, describe_wait
from tests.conftest import SESSION, FakeBackend, MakeClient, plan_model


class Clock:
    """A clock the test moves by hand."""

    def __init__(self) -> None:
        self.now = 1_000.0

    def __call__(self) -> float:
        return self.now

    def advance(self, seconds: float) -> None:
        self.now += seconds


def limiter(
    clock: Clock, per_minute: int = 0, per_day: int = 0, everyone: int = 0
) -> SearchLimiter:
    return SearchLimiter(
        per_minute=per_minute, per_day=per_day, global_per_day=everyone, clock=clock
    )


def blocked(limits: SearchLimiter, reader: int) -> LimitExceeded:
    with pytest.raises(LimitExceeded) as caught:
        limits.check_and_record(reader)
    return caught.value


# ------------------------------------------------------------------------ The limiter


def test_per_minute_limit_slides() -> None:
    clock = Clock()
    limits = limiter(clock, per_minute=3)
    for _ in range(3):
        limits.check_and_record(1)
        clock.advance(10)  # at 0, 10, 20 seconds

    error = blocked(limits, 1)  # at 30 s: the oldest frees up at 60 s
    assert error.retry_after == 30
    assert error.message == "You're asking too fast. Try again in 30 seconds."

    clock.advance(30)
    limits.check_and_record(1)  # 60 s: the first one has left the window


def test_a_blocked_request_is_not_counted() -> None:
    clock = Clock()
    limits = limiter(clock, per_minute=1)
    limits.check_and_record(1)
    for _ in range(5):
        blocked(limits, 1)
    clock.advance(MINUTE)
    limits.check_and_record(1)


def test_readers_are_counted_separately() -> None:
    limits = limiter(Clock(), per_minute=1)
    limits.check_and_record(1)
    limits.check_and_record(2)
    blocked(limits, 1)


def test_daily_limit_per_reader() -> None:
    clock = Clock()
    limits = limiter(clock, per_day=2)
    limits.check_and_record(1)
    clock.advance(3600)
    limits.check_and_record(1)
    clock.advance(3600)

    error = blocked(limits, 1)
    assert error.retry_after == int(DAY - 2 * 3600)
    assert error.message == (
        "You've used your 2 AI searches for today. Try again in 22 hours, or use the filters."
    )
    limits.check_and_record(2)  # someone else is fine

    clock.advance(DAY - 2 * 3600)
    limits.check_and_record(1)


def test_global_daily_limit_covers_everyone() -> None:
    clock = Clock()
    limits = limiter(clock, everyone=3)
    for reader in (1, 2, 3):
        limits.check_and_record(reader)
    error = blocked(limits, 4)
    assert error.message.startswith("AI search has reached its daily limit for everyone.")
    clock.advance(DAY)
    limits.check_and_record(4)


def test_zero_turns_every_limit_off() -> None:
    limits = limiter(Clock())
    for _ in range(1_000):
        limits.check_and_record(1)


def test_old_searches_are_forgotten() -> None:
    clock = Clock()
    limits = limiter(clock, per_day=5)
    for _ in range(5):
        limits.check_and_record(1)
    clock.advance(DAY + 1)
    limits.check_and_record(1)
    assert len(limits._readers[1]) == 1  # memory doesn't grow forever
    assert len(limits._everyone) == 1


@pytest.mark.parametrize(
    ("seconds", "text"),
    [
        (1, "1 second"),
        (45, "45 seconds"),
        (60, "1 minute"),
        (61, "2 minutes"),
        (3599, "60 minutes"),
        (3600, "1 hour"),
        (7201, "3 hours"),
    ],
)
def test_describe_wait(seconds: int, text: str) -> None:
    assert describe_wait(seconds) == text


# ------------------------------------------------------------------------ Settings


def test_limit_defaults() -> None:
    settings = load_settings({})
    assert (settings.limit_per_minute, settings.limit_per_day) == (10, 100)
    assert settings.limit_global_per_day == 500


def test_limits_from_env() -> None:
    settings = load_settings(
        {"AI_LIMIT_PER_MINUTE": " 3 ", "AI_LIMIT_PER_DAY": "0", "AI_LIMIT_GLOBAL_PER_DAY": "50"}
    )
    assert (settings.limit_per_minute, settings.limit_per_day) == (3, 0)
    assert settings.limit_global_per_day == 50


@pytest.mark.parametrize("raw", ["-1", "ten", "1.5"])
def test_invalid_limit_names_the_variable(raw: str) -> None:
    with pytest.raises(ConfigError, match="AI_LIMIT_PER_DAY must be a whole number"):
        load_settings({"AI_LIMIT_PER_DAY": raw})


# ------------------------------------------------------------------- Who is asking


@pytest.mark.anyio
@pytest.mark.parametrize(
    "body",
    [{"username": "no id"}, {"id": "7"}, {"id": True}, ["not", "an", "object"]],
    ids=["no-id", "string-id", "bool-id", "list"],
)
async def test_unexpected_auth_me_is_backend_unavailable(body: Any) -> None:
    transport = httpx.MockTransport(lambda r: httpx.Response(200, json=body))
    async with httpx.AsyncClient(base_url="http://b.test", transport=transport) as http:
        with pytest.raises(BackendUnavailable):
            await VaultClient(http, SESSION).reader_id()


# ------------------------------------------------------------------------- The API


def ask(client: Any, question: str = "fantasy") -> Any:
    return client.post("/search", json={"question": question})


def test_too_many_searches_is_429_with_retry_after(make_client: MakeClient) -> None:
    clock = Clock()
    client = make_client(model=plan_model(genre="Fantasy"), clock=clock, limit_per_minute=2)
    assert ask(client).status_code == 200
    assert ask(client).status_code == 200

    response = ask(client)
    assert response.status_code == 429
    assert response.headers["retry-after"] == "60"
    assert response.json() == {"detail": "You're asking too fast. Try again in 1 minute."}

    clock.advance(MINUTE)
    assert ask(client).status_code == 200


def test_a_limited_search_never_calls_the_model(make_client: MakeClient) -> None:
    calls: list[str] = []
    model = plan_model(genre="Fantasy")
    original: Callable[..., Any] = model.function  # type: ignore[assignment]

    def counting(*args: Any) -> Any:
        calls.append("model")
        return original(*args)

    model.function = counting  # type: ignore[method-assign]
    client = make_client(model=model, clock=Clock(), limit_per_minute=1)
    ask(client)
    assert ask(client).status_code == 429
    assert calls == ["model"]


def test_the_limit_follows_the_account_not_the_session(make_client: MakeClient) -> None:
    """Two sessions of the same reader (another device, or logging in again) share it."""

    def handler(request: httpx.Request) -> httpx.Response:
        cookie = request.headers.get("cookie", "")
        if cookie in {f"{SESSION_COOKIE}={SESSION}", f"{SESSION_COOKIE}=second-device"}:
            request.headers["cookie"] = f"{SESSION_COOKIE}={SESSION}"
        return FakeBackend()(request)

    client = make_client(
        backend=handler, model=plan_model(genre="Fantasy"), clock=Clock(), limit_per_minute=1
    )
    assert ask(client).status_code == 200
    client.cookies.set(SESSION_COOKIE, "second-device")
    assert ask(client).status_code == 429


def test_global_limit_through_the_api(make_client: MakeClient) -> None:
    def handler(request: httpx.Request) -> httpx.Response:
        cookie = request.headers.get("cookie", "")
        if request.url.path == "/auth/me" and cookie.endswith("=other"):
            return httpx.Response(200, json={"id": 2, "username": "other"})
        if cookie.endswith("=other"):
            request.headers["cookie"] = f"{SESSION_COOKIE}={SESSION}"
        return FakeBackend()(request)

    client = make_client(
        backend=handler, model=plan_model(genre="Fantasy"), clock=Clock(), limit_global_per_day=1
    )
    assert ask(client).status_code == 200
    client.cookies.set(SESSION_COOKIE, "other")
    response = ask(client)
    assert response.status_code == 429
    assert "daily limit for everyone" in response.json()["detail"]


@pytest.mark.parametrize(
    ("setup", "expected"),
    [
        ({"logged_in": False}, 401),  # no cookie
        ({"ai_model": None, "model": None}, 503),  # AI not configured
    ],
    ids=["logged-out", "not-configured"],
)
def test_requests_that_never_reach_the_model_dont_count(
    make_client: MakeClient, setup: dict[str, Any], expected: int
) -> None:
    clock = Clock()
    failing = make_client(clock=clock, limit_global_per_day=1, **setup)
    for _ in range(3):
        assert ask(failing).status_code == expected
    assert failing.app.state.limiter._everyone == deque_empty()  # type: ignore[attr-defined]


def deque_empty() -> Any:
    from collections import deque

    return deque()


def test_invalid_question_and_expired_session_dont_count(make_client: MakeClient) -> None:
    client = make_client(model=plan_model(genre="Fantasy"), clock=Clock(), limit_per_minute=1)
    assert ask(client, "").status_code == 422
    client.cookies.set(SESSION_COOKIE, "expired")
    assert ask(client).status_code == 401
    client.cookies.set(SESSION_COOKIE, SESSION)
    assert ask(client).status_code == 200


def test_429_is_documented(make_client: MakeClient) -> None:
    responses = make_client().get("/openapi.json").json()["paths"]["/search"]["post"]["responses"]
    assert "429" in responses
