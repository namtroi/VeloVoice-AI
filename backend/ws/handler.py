"""WebSocket handler for VeloVoice AI.

Connection lifecycle
--------------------
  connect
  └─ recv loop:
       ├─ binary frame  → realtime_client.send_audio(bytes)
       └─ text frame    → parse ClientMessage
            ├─ session.start  → session_store.create(), RealtimeClient.connect(), send session.ready
            ├─ audio.stop     → realtime_client.flush()
            └─ session.end    → realtime_client.close(), session_store.delete(), close WS 1000

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
from pydantic import TypeAdapter, ValidationError

from observability.logger import get_logger
from pipeline.realtime_client import RealtimeClient, RealtimeClientError
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

_client_message_adapter = TypeAdapter(ClientMessage)


async def _send_json(ws: WebSocket, payload: dict) -> None:
    """Serialise and send a JSON text frame."""
    await ws.send_text(json.dumps(payload))


def _make_send_callback(ws: WebSocket):
    """Return an async callback that forwards events from RealtimeClient to the browser WS."""
    async def _send(payload: dict) -> None:
        # Special internal type for raw audio bytes — send as binary frame
        if payload.get("type") == "__audio_bytes__":
            await ws.send_bytes(payload["bytes"])
        else:
            await _send_json(ws, payload)
    return _send


@router.websocket("/ws")
async def websocket_endpoint(ws: WebSocket) -> None:
    await ws.accept()
    log.info("ws_connected", extra={"action": "ws_connected"})

    session_id: str | None = None
    realtime_client: RealtimeClient | None = None

    try:
        while True:
            message = await ws.receive()

            # ----------------------------------------------------------------
            # Binary frame — audio chunk
            # ----------------------------------------------------------------
            if "bytes" in message and message["bytes"] is not None:
                if session_id is None or realtime_client is None:
                    await _send_json(
                        ws,
                        error_msg(
                            "SESSION_NOT_FOUND",
                            "Send session.start before streaming audio.",
                            fatal=False,
                        ),
                    )
                    continue
                await realtime_client.send_audio(message["bytes"])
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
                    error_msg("INVALID_MESSAGE_TYPE", "Message must be valid JSON.", fatal=False),
                )
                log.warning("ws_message_invalid", extra={"action": "ws_message_invalid", "session_id": session_id})
                continue

            try:
                msg = _client_message_adapter.validate_python(data)
            except ValidationError as exc:
                errors = exc.errors()
                is_unknown_type = any(
                    e.get("type") == "union_tag_invalid" or e.get("loc") == ("type",)
                    for e in errors
                )
                code = "INVALID_MESSAGE_TYPE" if is_unknown_type else "INVALID_MESSAGE_SCHEMA"
                await _send_json(ws, error_msg(code, str(exc), fatal=False))
                log.warning(
                    "ws_message_invalid",
                    extra={"action": "ws_message_invalid", "session_id": session_id, "metadata": {"code": code}},
                )
                continue

            # ----------------------------------------------------------------
            # Dispatch
            # ----------------------------------------------------------------
            if isinstance(msg, SessionStartMessage):
                session_id = str(uuid.uuid4())
                session = session_store.create(session_id)

                realtime_client = RealtimeClient(
                    session_id=session_id,
                    send_to_client=_make_send_callback(ws),
                )

                try:
                    await realtime_client.connect(
                        voice=msg.config.voice,
                        history=session.history,
                    )
                except RealtimeClientError as exc:
                    session_store.delete(session_id)
                    await _send_json(
                        ws,
                        error_msg("OPENAI_CONNECTION_FAILED", str(exc), fatal=True),
                    )
                    await ws.close(code=1011)
                    return

                session.realtime_client = realtime_client
                await _send_json(ws, session_ready(session_id))

            elif isinstance(msg, AudioStopMessage):
                if session_id is None or realtime_client is None:
                    await _send_json(
                        ws,
                        error_msg("SESSION_NOT_FOUND", "No active session. Send session.start first.", fatal=False),
                    )
                    continue
                await realtime_client.flush()

            elif isinstance(msg, SessionEndMessage):
                if realtime_client is not None:
                    await realtime_client.close()
                if session_id is not None:
                    session_store.delete(session_id)
                await ws.close(code=1000)
                return

    except WebSocketDisconnect:
        log.info("ws_disconnected", extra={"action": "ws_disconnected", "session_id": session_id})
    except Exception:  # noqa: BLE001
        log.exception("ws_internal_error", extra={"action": "pipeline_error", "session_id": session_id})
        try:
            await _send_json(ws, error_msg("INTERNAL_ERROR", "An unexpected error occurred.", fatal=True))
            await ws.close(code=1011)
        except Exception as close_exc:
            log.debug(
                "ws_close_after_error_failed",
                extra={
                    "action": "ws_close_after_error_failed",
                    "session_id": session_id,
                    "metadata": {"error": str(close_exc)},
                },
            )
    finally:
        if realtime_client is not None:
            await realtime_client.close()
        if session_id and session_store.get(session_id):
            session_store.delete(session_id)
