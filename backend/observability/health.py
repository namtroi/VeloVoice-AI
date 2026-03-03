"""Health check router — GET /health."""

import asyncio
import time

from fastapi import APIRouter
from fastapi.responses import JSONResponse

from session.store import session_store

router = APIRouter()

_start_time = time.time()

OPENAI_HOST = "api.openai.com"
OPENAI_PORT = 443
CONNECT_TIMEOUT = 5.0  # seconds


async def _check_openai_reachable() -> bool:
    """Attempt a TCP connection to the OpenAI API endpoint."""
    try:
        _, writer = await asyncio.wait_for(
            asyncio.open_connection(OPENAI_HOST, OPENAI_PORT),
            timeout=CONNECT_TIMEOUT,
        )
        writer.close()
        await writer.wait_closed()
        return True
    except Exception:
        return False


@router.get("/health")
async def health() -> JSONResponse:
    """Return system health status.

    Returns 200 when healthy, 503 when OpenAI is unreachable.
    """
    openai_ok = await _check_openai_reachable()
    uptime = round(time.time() - _start_time, 1)

    body = {
        "status": "healthy" if openai_ok else "degraded",
        "checks": {
            "openai_realtime": "reachable" if openai_ok else "unreachable",
        },
        "active_sessions": session_store.active_count,
        "uptime_seconds": uptime,
    }

    status_code = 200 if openai_ok else 503
    return JSONResponse(content=body, status_code=status_code)
