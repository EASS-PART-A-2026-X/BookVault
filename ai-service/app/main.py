"""FastAPI app for the Book Vault AI service."""

import os
from collections.abc import AsyncIterator
from contextlib import asynccontextmanager
from typing import Literal

import httpx
from fastapi import FastAPI, Request
from pydantic import BaseModel

from app.config import ModelStatus, Settings, load_settings, resolve_model


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


app = create_app()
