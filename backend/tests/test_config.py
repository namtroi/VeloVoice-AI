"""Tests for config.py lazy Settings instantiation."""

import importlib


def test_settings_can_be_imported_without_api_key(monkeypatch):
    """Importing config without OPENAI_API_KEY must not raise ValidationError."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    import config  # noqa: PLC0415 — intentional import inside test
    assert config.settings is not None


def test_settings_proxy_reads_env_var(monkeypatch):
    """Settings proxy must reflect OPENAI_API_KEY from the environment."""
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test-123")
    import config as cfg
    # Clear the lru_cache so the new env var is picked up
    cfg.get_settings.cache_clear()
    importlib.reload(cfg)
    assert cfg.settings.openai_api_key == "sk-test-123"


def test_settings_proxy_returns_defaults(monkeypatch):
    """Default values from Settings must be accessible via the proxy."""
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    import config as cfg
    cfg.get_settings.cache_clear()
    importlib.reload(cfg)
    assert cfg.settings.openai_model == "gpt-4o-realtime-preview"
    assert cfg.settings.session_ttl_seconds == 1800
    assert cfg.settings.history_max_turns == 20
