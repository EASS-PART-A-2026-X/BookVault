"""Calls to the Book Vault backend, always as the reader (their own session cookie).

The AI service never opens the database. Every read goes through the backend's API,
so ownership and privacy rules are enforced in exactly one place.
"""

from dataclasses import dataclass

import httpx
from pydantic import TypeAdapter, ValidationError

from app.schemas import SearchPlan, VaultBook

SESSION_COOKIE = "bv_session"


class BackendError(Exception):
    """Base class: the backend couldn't answer the way we needed."""


class BackendUnavailable(BackendError):
    """Unreachable, timed out, 5xx, or an answer we can't parse."""


class NotLoggedIn(BackendError):
    """The backend rejected the reader's session (401)."""


_books = TypeAdapter(list[VaultBook])
_me = TypeAdapter(dict[str, object])
_tropes = TypeAdapter(list[dict[str, object]])


def plan_to_params(plan: SearchPlan) -> dict[str, str | int]:
    """SearchPlan -> GET /books query parameters (the backend's own filter names)."""
    params: dict[str, str | int] = {}
    if plan.genre is not None:
        params["genre"] = plan.genre.value
    if plan.read_status is not None:
        params["is_read"] = "true" if plan.read_status == "read" else "false"
    if plan.min_rating is not None:
        params["min_rating"] = plan.min_rating
    if plan.trope is not None:
        params["trope"] = plan.trope
    return params


def matches_text(book: VaultBook, text: str | None) -> bool:
    """Every word of `text` appears in the title or author (case-insensitive)."""
    if not text:
        return True
    haystack = f"{book.title} {book.author}".lower()
    return all(word in haystack for word in text.lower().split())


@dataclass
class VaultClient:
    """The reader's view of their vault. `http` is shared; `session` is per request."""

    http: httpx.AsyncClient
    session: str

    async def _get(self, path: str, params: dict[str, str | int] | None = None) -> object:
        try:
            # A plain Cookie header per request: the shared client never stores
            # cookies, so one reader's session can't leak into another's request.
            response = await self.http.get(
                path, params=params, headers={"Cookie": f"{SESSION_COOKIE}={self.session}"}
            )
        except httpx.HTTPError as exc:
            raise BackendUnavailable(f"Book Vault backend unreachable: {exc!r}") from exc
        if response.status_code == 401:
            raise NotLoggedIn("Session rejected by the backend")
        if response.status_code != 200:
            raise BackendUnavailable(f"Book Vault backend answered {response.status_code}")
        try:
            return response.json()
        except ValueError as exc:
            raise BackendUnavailable("Book Vault backend sent invalid JSON") from exc

    async def reader_id(self) -> int:
        """Who is asking (GET /auth/me). Also proves the session is valid before any
        model call, so an expired cookie costs nothing."""
        try:
            reader = _me.validate_python(await self._get("/auth/me"))
            reader_id = reader["id"]
        except (ValidationError, KeyError) as exc:
            raise BackendUnavailable("Unexpected /auth/me response") from exc
        if not isinstance(reader_id, int) or isinstance(reader_id, bool):
            raise BackendUnavailable("Unexpected /auth/me response")
        return reader_id

    async def tropes(self) -> list[str]:
        """Names of the tropes on the reader's books."""
        try:
            rows = _tropes.validate_python(await self._get("/tropes"))
            return [str(row["name"]) for row in rows]
        except (ValidationError, KeyError) as exc:
            raise BackendUnavailable("Unexpected /tropes response") from exc

    async def search(self, plan: SearchPlan) -> list[VaultBook]:
        """Run the plan: the backend filters, then the title/author text match here."""
        try:
            books = _books.validate_python(await self._get("/books", plan_to_params(plan)))
        except ValidationError as exc:
            raise BackendUnavailable("Unexpected /books response") from exc
        return [book for book in books if matches_text(book, plan.text)]
