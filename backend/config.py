from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str
    openai_model: str = "gpt-4o-realtime-preview"
    session_ttl_seconds: int = 1800
    history_max_turns: int = 20


settings = Settings()
