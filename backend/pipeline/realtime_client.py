"""OpenAI Realtime API client for VeloVoice AI.

Proxies audio and control messages between the browser WebSocket and the
OpenAI Realtime WebSocket (wss://api.openai.com/v1/realtime).

Usage::

    async def send_to_client(payload: dict) -> None:
        await ws.send_text(json.dumps(payload))

    client = RealtimeClient(session_id="...", send_to_client=send_to_client)
    await client.connect(voice="alloy", history=[])
    await client.send_audio(pcm_bytes)
    await client.flush()      # called on audio.stop
    await client.close()      # called on session.end / disconnect

OpenAI events handled in the recv loop:
  response.audio.delta              → forward raw audio bytes to client WS
  response.audio_transcript.delta   → send transcript.partial
  response.done                     → send response.end, persist assistant turn
  response.function_call_arguments.done → execute tool, send result back
  error                             → map to error code, send to client
"""

import asyncio
import base64
import json
from typing import Callable, Awaitable

import websockets
from websockets.exceptions import ConnectionClosed

from config import settings
from observability.logger import get_logger
from pipeline.tools import TOOL_DEFINITIONS, TOOL_HANDLERS
from ws.message_types import (
    error_msg,
    response_end,
    transcript_final,
    transcript_partial,
)

log = get_logger(__name__)

OPENAI_WS_URL = "wss://api.openai.com/v1/realtime"

SendCallback = Callable[[dict], Awaitable[None]]


class RealtimeClientError(Exception):
    pass


class RealtimeClient:
    def __init__(self, session_id: str, send_to_client: SendCallback) -> None:
        self._session_id = session_id
        self._send = send_to_client
        self._ws = None
        self._recv_task: asyncio.Task | None = None
        # Accumulate audio transcript deltas per response turn
        self._partial_transcript: str = ""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    async def connect(self, voice: str = "alloy", history: list[dict] = None) -> None:
        """Open the OpenAI Realtime WebSocket and start the recv loop."""
        history = history or []
        # Enforce the configured turn limit — keep the most recent N turns
        max_turns = settings.history_max_turns
        if len(history) > max_turns:
            log.debug(
                "history_truncated",
                extra={
                    "action": "history_truncated",
                    "session_id": self._session_id,
                    "metadata": {"original": len(history), "max": max_turns},
                },
            )
            history = history[-max_turns:]
        url = f"{OPENAI_WS_URL}?model={settings.openai_model}"
        headers = {
            "Authorization": f"Bearer {settings.openai_api_key}",
            "OpenAI-Beta": "realtime=v1",
        }
        try:
            self._ws = await websockets.connect(url, extra_headers=headers)
        except Exception as exc:
            log.error(
                "realtime_connection_failed",
                extra={
                    "action": "pipeline_error",
                    "session_id": self._session_id,
                    "metadata": {"error": str(exc)},
                },
            )
            raise RealtimeClientError("OPENAI_CONNECTION_FAILED") from exc

        # Configure session
        await self._send_event({
            "type": "session.update",
            "session": {
                "model": settings.openai_model,
                "voice": voice,
                "modalities": ["text", "audio"],
                "input_audio_format": "pcm16",
                "output_audio_format": "pcm16",
                "instructions": (
                    "You are VeloVoice, a friendly and efficient voice assistant. "
                    "Be concise and helpful."
                ),
                "tools": TOOL_DEFINITIONS,
                "tool_choice": "auto",
                "turn_detection": None,  # we handle VAD on the client side
            },
        })

        # Replay conversation history
        for turn in history:
            await self._send_event({
                "type": "conversation.item.create",
                "item": {
                    "type": "message",
                    "role": turn.get("role", "user"),
                    "content": [{"type": "input_text", "text": turn.get("content", "")}],
                },
            })

        self._recv_task = asyncio.create_task(self._recv_loop())
        log.info(
            "realtime_session_opened",
            extra={"action": "realtime_session_opened", "session_id": self._session_id},
        )

    async def send_audio(self, pcm_bytes: bytes) -> None:
        """Forward a raw PCM chunk to OpenAI's audio buffer."""
        if not self._ws:
            return
        encoded = base64.b64encode(pcm_bytes).decode()
        await self._send_event({
            "type": "input_audio_buffer.append",
            "audio": encoded,
        })

    async def flush(self) -> None:
        """Commit the audio buffer and request a response (called on audio.stop)."""
        if not self._ws:
            return
        await self._send_event({"type": "input_audio_buffer.commit"})
        await self._send_event({"type": "response.create"})

    async def close(self) -> None:
        """Tear down the OpenAI WS connection and cancel the recv loop."""
        if self._recv_task and not self._recv_task.done():
            self._recv_task.cancel()
            try:
                await self._recv_task
            except asyncio.CancelledError:
                pass
        if self._ws:
            try:
                await self._ws.close()
            except Exception as exc:
                log.debug(
                    "realtime_ws_close_error",
                    extra={
                        "action": "realtime_ws_close_error",
                        "session_id": self._session_id,
                        "metadata": {"error": str(exc)},
                    },
                )
            self._ws = None

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    async def _send_event(self, event: dict) -> None:
        """Send a JSON event to the OpenAI WS."""
        if self._ws:
            await self._ws.send(json.dumps(event))

    async def _recv_loop(self) -> None:
        """Consume events from the OpenAI Realtime WS and dispatch them."""
        try:
            async for raw in self._ws:
                try:
                    event = json.loads(raw)
                except json.JSONDecodeError:
                    continue
                await self._dispatch(event)
        except ConnectionClosed:
            pass
        except asyncio.CancelledError:
            raise
        except Exception as exc:
            log.error(
                "pipeline_error",
                extra={
                    "action": "pipeline_error",
                    "session_id": self._session_id,
                    "metadata": {"error": str(exc)},
                },
            )
            await self._send(
                error_msg("INTERNAL_ERROR", "OpenAI connection lost unexpectedly.", fatal=True)
            )

    async def _dispatch(self, event: dict) -> None:
        """Route an OpenAI event to the appropriate handler."""
        etype = event.get("type", "")

        if etype == "response.audio.delta":
            # Forward raw audio bytes to the client browser
            delta_b64 = event.get("delta", "")
            if delta_b64:
                audio_bytes = base64.b64decode(delta_b64)
                # Send binary frame directly — bypass JSON encoding
                # (handler will attach a binary-send callback in Phase 4 integration)
                await self._send({"type": "__audio_bytes__", "bytes": audio_bytes})

        elif etype == "response.audio_transcript.delta":
            delta = event.get("delta", "")
            self._partial_transcript += delta
            await self._send(
                transcript_partial(self._partial_transcript, self._session_id)
            )

        elif etype == "response.done":
            # Emit the final transcript and reset accumulator
            if self._partial_transcript:
                await self._send(
                    transcript_final(self._partial_transcript, self._session_id)
                )
                self._partial_transcript = ""
            await self._send(response_end(self._session_id))
            log.info(
                "response_ended",
                extra={"action": "response_ended", "session_id": self._session_id},
            )

        elif etype == "response.function_call_arguments.done":
            await self._handle_tool_call(event)

        elif etype == "error":
            await self._handle_error(event)

    async def _handle_tool_call(self, event: dict) -> None:
        """Execute a tool and send the result back to OpenAI."""
        call_id = event.get("call_id", "")
        fn_name = event.get("name", "")
        raw_args = event.get("arguments", "{}")

        try:
            args = json.loads(raw_args)
        except json.JSONDecodeError:
            args = {}

        handler = TOOL_HANDLERS.get(fn_name)
        if handler:
            try:
                result = handler(args)
            except Exception as exc:
                result = json.dumps({"error": str(exc)})
        else:
            result = json.dumps({"error": f"Unknown tool: {fn_name}"})

        await self._send_event({
            "type": "conversation.item.create",
            "item": {
                "type": "function_call_output",
                "call_id": call_id,
                "output": result,
            },
        })
        await self._send_event({"type": "response.create"})

    async def _handle_error(self, event: dict) -> None:
        """Map an OpenAI error event to a client error message."""
        openai_code = event.get("code", "")
        openai_msg = event.get("message", "Unknown error from OpenAI.")

        if openai_code == "rate_limit_exceeded" or "429" in openai_msg:
            code = "OPENAI_RATE_LIMITED"
            fatal = True
        else:
            code = "OPENAI_API_ERROR"
            fatal = False

        log.error(
            "pipeline_error",
            extra={
                "action": "pipeline_error",
                "session_id": self._session_id,
                "metadata": {"openai_code": openai_code, "code": code},
            },
        )
        await self._send(error_msg(code, openai_msg, fatal=fatal))
