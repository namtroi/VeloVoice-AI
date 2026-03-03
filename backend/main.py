"""VeloVoice AI — FastAPI application entrypoint."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI

from observability.health import router as health_router
from session.store import session_store
from ws.handler import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(session_store.cleanup_expired())
    yield


app = FastAPI(title="VeloVoice AI", lifespan=lifespan)

app.include_router(health_router)
app.include_router(ws_router)

