from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    openai_api_key: str = ""
    openai_model: str = "gpt-4o-realtime-preview"
    session_ttl_seconds: int = 1800
    history_max_turns: int = 20

    class Config:
        env_file = ".env"


settings = Settings()
