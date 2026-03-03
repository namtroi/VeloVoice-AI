"""VeloVoice AI — FastAPI application entrypoint."""

import asyncio

from fastapi import FastAPI

from observability.health import router as health_router
from session.store import session_store

app = FastAPI(title="VeloVoice AI")

app.include_router(health_router)
# WS router added in Phase 2


@app.on_event("startup")
async def _startup() -> None:
    """Start background tasks on application startup."""
    asyncio.create_task(session_store.cleanup_expired())
