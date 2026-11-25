# syntax=docker/dockerfile:1
# Same two-stage uv build as the backend (book-vault/Dockerfile).

# ---- Builder: install dependencies from the lockfile with uv ----------------
FROM ghcr.io/astral-sh/uv:0.13-python3.11-trixie-slim AS builder

ENV UV_LINK_MODE=copy \
    UV_COMPILE_BYTECODE=1 \
    UV_PYTHON_DOWNLOADS=0

WORKDIR /app

COPY pyproject.toml uv.lock ./
RUN --mount=type=cache,target=/root/.cache/uv \
    uv sync --frozen --no-dev

# ---- Runtime: slim image with just the venv and the app code ----------------
FROM python:3.11-slim

ENV PATH="/app/.venv/bin:$PATH" \
    PYTHONDONTWRITEBYTECODE=1 \
    PYTHONUNBUFFERED=1 \
    PYDANTIC_AI_NO_BANNER=1

RUN groupadd --system app && useradd --system --gid app --no-create-home app

WORKDIR /app

COPY --from=builder /app/.venv /app/.venv
COPY app/ ./app/

USER app

EXPOSE 8100

# Settings (BACKEND_URL, AI_MODEL, provider key, timeouts) come from the environment.
CMD ["uvicorn", "app.main:app", "--host", "0.0.0.0", "--port", "8100"]
