"""VeloVoice AI — FastAPI application entrypoint."""

import asyncio
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from observability.health import router as health_router
from session.store import session_store
from ws.handler import router as ws_router


@asynccontextmanager
async def lifespan(app: FastAPI):
    asyncio.create_task(session_store.cleanup_expired())
    yield


app = FastAPI(title="VeloVoice AI", lifespan=lifespan)

app.add_middleware(
    CORSMiddleware,
    allow_origins=["http://localhost:3000", "http://localhost:5173", "http://127.0.0.1:3000", "http://127.0.0.1:5173"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(health_router)
app.include_router(ws_router)

