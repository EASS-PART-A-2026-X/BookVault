"""Settings for the AI service, read from environment variables only.

Nothing secret lives in code: the provider key (e.g. ANTHROPIC_API_KEY) is read by
Pydantic AI's provider straight from the environment, and never logged or returned.
"""

from collections.abc import Mapping
from dataclasses import dataclass

from pydantic_ai.exceptions import UserError
from pydantic_ai.models import Model, infer_model

DEFAULT_BACKEND_URL = "http://localhost:8000"
DEFAULT_AI_TIMEOUT_SECONDS = 20.0
DEFAULT_BACKEND_TIMEOUT_SECONDS = 5.0
# Search limits (see app/limits.py). 0 turns one off.
DEFAULT_LIMIT_PER_MINUTE = 10
DEFAULT_LIMIT_PER_DAY = 100
DEFAULT_LIMIT_GLOBAL_PER_DAY = 500


class ConfigError(ValueError):
    """A setting is present but unusable. Raised at startup so the service fails fast."""


@dataclass(frozen=True)
class Settings:
    backend_url: str
    # Pydantic AI model name, e.g. "anthropic:claude-haiku-5-5", or "fake" (offline
    # keyword model). None = AI disabled.
    ai_model: str | None
    ai_timeout_seconds: float
    backend_timeout_seconds: float
    limit_per_minute: int = DEFAULT_LIMIT_PER_MINUTE
    limit_per_day: int = DEFAULT_LIMIT_PER_DAY
    limit_global_per_day: int = DEFAULT_LIMIT_GLOBAL_PER_DAY


def _positive_float(env: Mapping[str, str], name: str, default: float) -> float:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    try:
        value = float(raw)
    except ValueError:
        raise ConfigError(f"{name} must be a number of seconds, got {raw!r}") from None
    if value <= 0:
        raise ConfigError(f"{name} must be greater than 0, got {raw!r}")
    return value


def _limit(env: Mapping[str, str], name: str, default: int) -> int:
    raw = env.get(name, "").strip()
    if not raw:
        return default
    if not raw.isdigit():
        raise ConfigError(f"{name} must be a whole number (0 = no limit), got {raw!r}")
    return int(raw)


def load_settings(env: Mapping[str, str]) -> Settings:
    """Build Settings from an environment mapping (os.environ in production)."""
    backend_url = env.get("BACKEND_URL", "").strip() or DEFAULT_BACKEND_URL
    if not backend_url.startswith(("http://", "https://")):
        raise ConfigError(f"BACKEND_URL must start with http:// or https://, got {backend_url!r}")
    return Settings(
        backend_url=backend_url.rstrip("/"),
        ai_model=env.get("AI_MODEL", "").strip() or None,
        ai_timeout_seconds=_positive_float(env, "AI_TIMEOUT_SECONDS", DEFAULT_AI_TIMEOUT_SECONDS),
        backend_timeout_seconds=_positive_float(
            env, "BACKEND_TIMEOUT_SECONDS", DEFAULT_BACKEND_TIMEOUT_SECONDS
        ),
        limit_per_minute=_limit(env, "AI_LIMIT_PER_MINUTE", DEFAULT_LIMIT_PER_MINUTE),
        limit_per_day=_limit(env, "AI_LIMIT_PER_DAY", DEFAULT_LIMIT_PER_DAY),
        limit_global_per_day=_limit(env, "AI_LIMIT_GLOBAL_PER_DAY", DEFAULT_LIMIT_GLOBAL_PER_DAY),
    )


@dataclass(frozen=True)
class ModelStatus:
    """The resolved model, or why there isn't one (shown by /health and in 503s)."""

    model: Model | None
    reason: str | None


# AI_MODEL=fake: offline keyword model (app/fake_model.py) for tests, CI and key-less demos.
FAKE_MODEL = "fake"
AI_NOT_CONFIGURED = "AI is not configured: set AI_MODEL (see .env.example)"


def resolve_model(settings: Settings) -> ModelStatus:
    """Turn AI_MODEL into a Pydantic AI model without making any network call.

    A missing AI_MODEL, an unknown model name or a missing provider key doesn't crash
    the service: the rest keeps working and AI requests get a clear 503 instead.
    """
    if settings.ai_model is None:
        return ModelStatus(model=None, reason=AI_NOT_CONFIGURED)
    if settings.ai_model == FAKE_MODEL:
        from app.fake_model import fake_model

        return ModelStatus(model=fake_model(), reason=None)
    try:
        return ModelStatus(model=infer_model(settings.ai_model), reason=None)
    except UserError as exc:
        # e.g. "Set the `ANTHROPIC_API_KEY` environment variable ..." or "Unknown model".
        # Only the first sentence: it names the missing variable, never a value.
        first_sentence = str(exc).split(". ")[0].rstrip(".")
        return ModelStatus(model=None, reason=f"AI is not configured: {first_sentence}")
