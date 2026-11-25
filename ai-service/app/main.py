"""FastAPI app for the Book Vault AI service."""

import logging
import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Any, Literal

import httpx
from fastapi import FastAPI, HTTPException, Request, status
from pydantic import BaseModel
from pydantic_ai.exceptions import (
    AgentRunError,
    ModelAPIError,
    ModelTimeoutError,
    RunTimedOut,
    UnexpectedModelBehavior,
    UsageLimitExceeded,
)

from app.agent import VaultDeps, plan_search
from app.backend import SESSION_COOKIE, BackendUnavailable, NotLoggedIn, VaultClient
from app.config import ModelStatus, Settings, load_settings, resolve_model
from app.schemas import ErrorResponse, SearchRequest, SearchResponse

logger = logging.getLogger("bookvault.ai")

# User-facing messages. They name the problem, never a key, prompt or raw provider body.
NOT_LOGGED_IN = "Not logged in"
BACKEND_UNAVAILABLE = "Book Vault is unavailable right now. Try again in a moment."
AI_TIMEOUT = "The AI took too long to answer. Try again, or use the filters."
AI_PROVIDER_ERROR = "The AI provider failed to answer. Try again, or use the filters."
AI_BAD_OUTPUT = "The AI couldn't turn that into a search. Try rephrasing it."


class HealthResponse(BaseModel):
    # The service itself is up whenever this answers; the other fields say whether
    # AI requests can work right now.
    status: Literal["ok"]
    ai: Literal["ready", "not_configured"]
    model: str | None
    detail: str | None
    backend: Literal["ok", "unreachable"]


def create_app(
    settings: Settings | None = None,
    backend_transport: httpx.AsyncBaseTransport | None = None,
) -> FastAPI:
    """Build the app. Tests pass settings and a fake backend transport; production reads
    os.environ and talks to the real backend."""

    @asynccontextmanager
    async def lifespan(app: FastAPI) -> AsyncIterator[None]:
        # Invalid settings raise ConfigError here, so the container exits with a clear
        # message instead of serving wrong behaviour.
        resolved = settings or load_settings(os.environ)
        app.state.settings = resolved
        app.state.model_status = resolve_model(resolved)
        async with httpx.AsyncClient(
            base_url=resolved.backend_url,
            timeout=resolved.backend_timeout_seconds,
            transport=backend_transport,
        ) as backend:
            app.state.backend = backend
            yield

    app = FastAPI(
        title="Book Vault AI",
        description="Natural-language search over your Book Vault, built on Pydantic AI.",
        version="0.1.0",
        lifespan=lifespan,
    )
    app.get("/health", response_model=HealthResponse)(health)
    app.post(
        "/search",
        response_model=SearchResponse,
        responses=SEARCH_ERRORS,
        summary="Search your vault in plain English",
    )(search)
    return app


async def health(request: Request) -> HealthResponse:
    """Liveness (always 200 while the process runs) plus AI and backend readiness."""
    settings: Settings = request.app.state.settings
    model_status: ModelStatus = request.app.state.model_status
    backend: httpx.AsyncClient = request.app.state.backend
    try:
        reply = await backend.get("/health")
        backend_state: Literal["ok", "unreachable"] = (
            "ok" if reply.status_code == 200 else "unreachable"
        )
    except httpx.HTTPError:
        backend_state = "unreachable"
    return HealthResponse(
        status="ok",
        ai="ready" if model_status.model is not None else "not_configured",
        model=settings.ai_model,
        detail=model_status.reason,
        backend=backend_state,
    )


def _error(description: str) -> dict[str, Any]:
    return {"model": ErrorResponse, "description": description}


SEARCH_ERRORS: dict[int | str, dict[str, Any]] = {
    401: _error(NOT_LOGGED_IN),
    502: _error("The AI provider failed, or its answer was unusable"),
    503: _error("AI not configured, or the Book Vault backend is unavailable"),
    504: _error(AI_TIMEOUT),
}


async def search(payload: SearchRequest, request: Request) -> SearchResponse:
    """Turn the question into filters with the AI, then run them against your vault.

    Failures never crash the service: each one maps to a status code and a message
    the frontend can show (401, 502, 503, 504; 422 for an invalid question)."""
    session = request.cookies.get(SESSION_COOKIE)
    if not session:
        # Checked before any model call: no tokens spent on anonymous requests.
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, NOT_LOGGED_IN)

    model_status: ModelStatus = request.app.state.model_status
    if model_status.model is None:
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, model_status.reason)

    settings: Settings = request.app.state.settings
    vault = VaultClient(http=request.app.state.backend, session=session)
    try:
        plan = await plan_search(
            payload.question, VaultDeps(vault), model_status.model, settings.ai_timeout_seconds
        )
        books = await vault.search(plan)
    except NotLoggedIn as exc:
        raise HTTPException(status.HTTP_401_UNAUTHORIZED, NOT_LOGGED_IN) from exc
    except BackendUnavailable as exc:
        logger.warning("backend unavailable: %s", exc)
        raise HTTPException(status.HTTP_503_SERVICE_UNAVAILABLE, BACKEND_UNAVAILABLE) from exc
    except (RunTimedOut, ModelTimeoutError) as exc:
        logger.warning("model timed out after %ss", settings.ai_timeout_seconds)
        raise HTTPException(status.HTTP_504_GATEWAY_TIMEOUT, AI_TIMEOUT) from exc
    except ModelAPIError as exc:
        logger.warning("model provider error: %s", type(exc).__name__)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, AI_PROVIDER_ERROR) from exc
    except (UnexpectedModelBehavior, UsageLimitExceeded) as exc:
        logger.warning("unusable model output: %s", exc)
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, AI_BAD_OUTPUT) from exc
    except AgentRunError as exc:  # any other Pydantic AI run failure
        logger.exception("agent run failed")
        raise HTTPException(status.HTTP_502_BAD_GATEWAY, AI_PROVIDER_ERROR) from exc
    return SearchResponse(plan=plan, books=books)


app = create_app()
