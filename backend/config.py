from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # Empty default allows module import without key present;
    # validation at runtime occurs on first attribute access via the proxy.
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-realtime-preview"
    session_ttl_seconds: int = 1800
    history_max_turns: int = 20


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    """Return the singleton Settings instance (lazy, cached)."""
    return Settings()


# Backwards-compatible alias so existing `from config import settings` still works.
# The proxy delegates attribute access to the real singleton on first use,
# avoiding eager construction at import time (which fails in CI without OPENAI_API_KEY).
class _SettingsProxy:
    def __getattr__(self, name: str):
        return getattr(get_settings(), name)

    def __setattr__(self, name: str, value):
        setattr(get_settings(), name, value)


settings = _SettingsProxy()
