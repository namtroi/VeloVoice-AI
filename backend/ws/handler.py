"""WebSocket handler for VeloVoice AI.

Connection lifecycle
--------------------
  connect
  └─ recv loop:
       ├─ binary frame  → buffer audio (Phase 3 wires to RealtimeClient)
       └─ text frame    → parse ClientMessage
            ├─ session.start  → session_store.create(), [Phase 3: open realtime client], send session.ready
            ├─ audio.stop     → [Phase 3: signal realtime client to flush]
            └─ session.end    → [Phase 3: close realtime client], session_store.delete(), close WS 1000

Error codes (non-fatal unless noted)
-------------------------------------
  INVALID_MESSAGE_TYPE   – unknown/missing type field
  INVALID_MESSAGE_SCHEMA – valid type but bad schema
  SESSION_NOT_FOUND      – audio.* before session.start
  INTERNAL_ERROR         – unhandled exception (fatal, close 1011)
"""

import json
import uuid

from fastapi import APIRouter, WebSocket, WebSocketDisconnect
from pydantic import ValidationError

from observability.logger import get_logger
from session.store import session_store
from ws.message_types import (
    AudioStopMessage,
    ClientMessage,
    SessionEndMessage,
    SessionStartMessage,
    error_msg,
    session_ready,
)

log = get_logger(__name__)
router = APIRouter()


async def _send_json(ws: WebSocket, payload: dict) -> None:
    """Serialise and send a JSON text frame."""
    await ws.send_text(json.dumps(payload))


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    log.info("ws_connected", extra={"action": "ws_connected"})

    session_id: str | None = None

    try:
        while True:
            # Receive next frame — binary or text
            message = await ws.receive()

            # ----------------------------------------------------------------
            # Binary frame — audio chunk
            # ----------------------------------------------------------------
            if "bytes" in message and message["bytes"] is not None:
                if session_id is None:
                    await _send_json(
                        ws,
                        error_msg(
                            "SESSION_NOT_FOUND",
                            "Send session.start before streaming audio.",
                            fatal=False,
                        ),
                    )
                    continue

                # Phase 3: forward to realtime client
                # await realtime_client.send_audio(message["bytes"])
                continue

            # ----------------------------------------------------------------
            # Text frame — control message
            # ----------------------------------------------------------------
            raw = message.get("text", "")
            if not raw:
                continue

            try:
                data = json.loads(raw)
            except json.JSONDecodeError:
                await _send_json(
                    ws,
                    error_msg(
                        "INVALID_MESSAGE_TYPE",
                        "Message must be valid JSON.",
                        fatal=False,
                    ),
                )
                log.warning(
                    "ws_message_invalid",
                    extra={"action": "ws_message_invalid", "session_id": session_id},
                )
                continue

            # Validate with discriminated union
            try:
                from pydantic import TypeAdapter

                adapter = TypeAdapter(ClientMessage)
                msg = adapter.validate_python(data)
            except ValidationError as exc:
                # Check if it's a missing/bad discriminator vs. schema error
                errors = exc.errors()
                is_unknown_type = any(
                    e.get("type") == "union_tag_invalid" or
                    e.get("loc") == ("type",)
                    for e in errors
                )
                code = "INVALID_MESSAGE_TYPE" if is_unknown_type else "INVALID_MESSAGE_SCHEMA"
                await _send_json(
                    ws,
                    error_msg(code, str(exc), fatal=False),
                )
                log.warning(
                    "ws_message_invalid",
                    extra={
                        "action": "ws_message_invalid",
                        "session_id": session_id,
                        "metadata": {"code": code},
                    },
                )
                continue

            # ----------------------------------------------------------------
            # Dispatch
            # ----------------------------------------------------------------
            if isinstance(msg, SessionStartMessage):
                session_id = str(uuid.uuid4())
                session_store.create(session_id)
                # Phase 3: open realtime client here
                await _send_json(ws, session_ready(session_id))

            elif isinstance(msg, AudioStopMessage):
                if session_id is None:
                    await _send_json(
                        ws,
                        error_msg(
                            "SESSION_NOT_FOUND",
                            "No active session. Send session.start first.",
                            fatal=False,
                        ),
                    )
                    continue
                # Phase 3: await realtime_client.flush()

            elif isinstance(msg, SessionEndMessage):
                if session_id is not None:
                    # Phase 3: await realtime_client.close()
                    session_store.delete(session_id)
                await ws.close(code=1000)
                return

    except WebSocketDisconnect:
        log.info(
            "ws_disconnected",
            extra={"action": "ws_disconnected", "session_id": session_id},
        )
    except Exception as exc:  # noqa: BLE001
        log.exception(
            "ws_internal_error",
            extra={"action": "pipeline_error", "session_id": session_id},
        )
        try:
            await _send_json(
                ws,
                error_msg("INTERNAL_ERROR", "An unexpected error occurred.", fatal=True),
            )
            await ws.close(code=1011)
        except Exception:
            pass
    finally:
        # Cleanup: if session still active (e.g. client disconnected mid-session)
        if session_id and session_store.get(session_id):
            session_store.delete(session_id)
