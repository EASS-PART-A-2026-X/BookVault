"""The backend client: plan -> query params, text matching, and every failure mode."""

import httpx
import pytest

from app.backend import (
    BackendUnavailable,
    NotLoggedIn,
    VaultClient,
    matches_text,
    plan_to_params,
)
from app.schemas import Genre, SearchPlan, VaultBook
from tests.conftest import SESSION, FakeBackend

pytestmark = pytest.mark.anyio


def plan(**fields: object) -> SearchPlan:
    return SearchPlan(explanation="x", **fields)  # type: ignore[arg-type]


def client(handler: object) -> VaultClient:
    http = httpx.AsyncClient(base_url="http://backend.test", transport=httpx.MockTransport(handler))  # type: ignore[arg-type]
    return VaultClient(http=http, session=SESSION)


def test_empty_plan_has_no_params() -> None:
    assert plan_to_params(plan()) == {}


def test_full_plan_uses_the_backend_filter_names() -> None:
    params = plan_to_params(
        plan(genre=Genre.SCI_FI, read_status="unread", min_rating=4, trope="Found Family")
    )
    assert params == {
        "genre": "Sci-Fi",
        "is_read": "false",
        "min_rating": 4,
        "trope": "found family",
    }
    assert plan_to_params(plan(read_status="read"))["is_read"] == "true"


@pytest.mark.parametrize(
    ("text", "expected"),
    [(None, True), ("tolkien", True), ("HOBBIT tolkien", True), ("herbert", False)],
)
def test_matches_text_on_title_and_author(text: str | None, expected: bool) -> None:
    hobbit = VaultBook(
        id=1,
        title="The Hobbit",
        author="J.R.R. Tolkien",
        genre=Genre.FANTASY,
        rating=None,
        is_read=False,
        review=None,
        tropes=[],
        created_at="2026-11-25T10:00:00",
        updated_at="2026-11-25T10:00:00",
    )
    assert matches_text(hobbit, text) is expected


async def test_search_sends_the_session_and_filters(backend: FakeBackend) -> None:
    books = await client(backend).search(plan(genre=Genre.FANTASY, text="baldree"))
    assert [b.title for b in books] == ["Legends & Lattes"]
    sent = backend.requests[-1]
    assert sent.url.params["genre"] == "Fantasy"
    assert sent.headers["cookie"] == f"bv_session={SESSION}"


async def test_tropes(backend: FakeBackend) -> None:
    assert await client(backend).tropes() == ["chosen one", "cozy", "found family", "quest"]


def refused(request: httpx.Request) -> httpx.Response:
    raise httpx.ConnectError("connection refused", request=request)


def timed_out(request: httpx.Request) -> httpx.Response:
    raise httpx.ReadTimeout("timed out", request=request)


@pytest.mark.parametrize(
    "handler",
    [
        refused,
        timed_out,
        lambda r: httpx.Response(500, text="Internal Server Error"),
        lambda r: httpx.Response(503, json={"detail": "Database unavailable"}),
        lambda r: httpx.Response(200, text="<html>not json</html>"),
        lambda r: httpx.Response(200, json={"unexpected": "shape"}),
        lambda r: httpx.Response(200, json=[{"no_name": 1}]),
    ],
    ids=["refused", "timeout", "500", "db-down-503", "not-json", "bad-shape", "bad-row"],
)
async def test_backend_failures_raise_backend_unavailable(handler: object) -> None:
    with pytest.raises(BackendUnavailable):
        await client(handler).tropes()
    with pytest.raises(BackendUnavailable):
        await client(handler).search(plan())


async def test_rejected_session_raises_not_logged_in() -> None:
    vault = client(lambda r: httpx.Response(401, json={"detail": "Not authenticated"}))
    with pytest.raises(NotLoggedIn):
        await vault.search(plan())
