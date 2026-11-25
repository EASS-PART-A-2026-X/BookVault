"""Settings come from env vars; bad or missing values fail clearly, never crash."""

import pytest

from app.config import (
    AI_NOT_CONFIGURED,
    DEFAULT_AI_TIMEOUT_SECONDS,
    DEFAULT_BACKEND_URL,
    ConfigError,
    load_settings,
    resolve_model,
)


def test_defaults_when_env_is_empty() -> None:
    settings = load_settings({})
    assert settings.backend_url == DEFAULT_BACKEND_URL
    assert settings.ai_model is None
    assert settings.ai_timeout_seconds == DEFAULT_AI_TIMEOUT_SECONDS


def test_values_are_read_and_trimmed() -> None:
    settings = load_settings(
        {
            "BACKEND_URL": " http://backend:8000/ ",
            "AI_MODEL": " anthropic:claude-haiku-5-5 ",
            "AI_TIMEOUT_SECONDS": "7.5",
            "BACKEND_TIMEOUT_SECONDS": "2",
        }
    )
    assert settings.backend_url == "http://backend:8000"
    assert settings.ai_model == "anthropic:claude-haiku-5-5"
    assert settings.ai_timeout_seconds == 7.5
    assert settings.backend_timeout_seconds == 2.0


@pytest.mark.parametrize(
    ("env", "message"),
    [
        ({"AI_TIMEOUT_SECONDS": "soon"}, "AI_TIMEOUT_SECONDS must be a number"),
        ({"AI_TIMEOUT_SECONDS": "0"}, "AI_TIMEOUT_SECONDS must be greater than 0"),
        ({"BACKEND_TIMEOUT_SECONDS": "-1"}, "BACKEND_TIMEOUT_SECONDS must be greater than 0"),
        ({"BACKEND_URL": "backend:8000"}, "BACKEND_URL must start with http"),
    ],
)
def test_invalid_values_raise_config_error(env: dict[str, str], message: str) -> None:
    with pytest.raises(ConfigError, match=message):
        load_settings(env)


def test_missing_ai_model_disables_ai() -> None:
    status = resolve_model(load_settings({}))
    assert status.model is None
    assert status.reason == AI_NOT_CONFIGURED


def test_missing_provider_key_disables_ai(monkeypatch: pytest.MonkeyPatch) -> None:
    monkeypatch.delenv("ANTHROPIC_API_KEY", raising=False)
    status = resolve_model(load_settings({"AI_MODEL": "anthropic:claude-haiku-5-5"}))
    assert status.model is None
    assert status.reason is not None
    assert "ANTHROPIC_API_KEY" in status.reason


def test_unknown_model_disables_ai() -> None:
    status = resolve_model(load_settings({"AI_MODEL": "nonsense:model"}))
    assert status.model is None
    assert status.reason == "AI is not configured: Unknown model: nonsense:model"


def test_provider_key_from_env_resolves_offline(monkeypatch: pytest.MonkeyPatch) -> None:
    # A dummy key: resolving the model makes no request, so nothing is sent anywhere.
    monkeypatch.setenv("ANTHROPIC_API_KEY", "dummy-key-for-tests")
    status = resolve_model(load_settings({"AI_MODEL": "anthropic:claude-haiku-5-5"}))
    assert status.model is not None
    assert status.reason is None
