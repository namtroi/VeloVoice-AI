"""Tests for RealtimeClient — audio proxy, event forwarding, tool calls.

All tests mock the OpenAI WebSocket so no real network calls are made.
"""

import asyncio
import base64
import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from pipeline.realtime_client import RealtimeClient, RealtimeClientError


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def b64(data: bytes) -> str:
    return base64.b64encode(data).decode()


def make_ws_mock(events: list[dict]) -> MagicMock:
    """Create a mock OpenAI WS that yields the given events then stops."""
    ws = MagicMock()
    ws.send = AsyncMock()
    ws.close = AsyncMock()

    async def _aiter():
        for ev in events:
            yield json.dumps(ev)

    ws.__aiter__ = lambda self: _aiter()
    return ws


def patch_connect(ws_mock: MagicMock):
    """Return (patches...) that mock websockets.connect (AsyncMock) and settings.

    Usage: use with two nested `with` blocks::

        p_conn, p_cfg = patch_connect(ws_mock)
        with p_conn, p_cfg:
            ...
    """
    connect_mock = AsyncMock(return_value=ws_mock)
    return (
        patch("pipeline.realtime_client.websockets.connect", new=connect_mock),
        patch(
            "pipeline.realtime_client.settings",
            openai_api_key="test-key",
            openai_model="gpt-4o-realtime-preview",
        ),
    )


async def collect_sent(client: RealtimeClient, events: list[dict]) -> list[dict]:
    """Connect client with mocked WS, run recv_loop, return all payloads sent to browser."""
    received: list[dict] = []

    async def capture(payload: dict):
        received.append(payload)

    client._send = capture
    ws_mock = make_ws_mock(events)
    p_conn, p_cfg = patch_connect(ws_mock)
    with p_conn, p_cfg:
        await client.connect(voice="alloy", history=[])
        if client._recv_task:
            try:
                await asyncio.wait_for(client._recv_task, timeout=2.0)
            except asyncio.TimeoutError:
                pass
    return received


# ---------------------------------------------------------------------------
# connect()
# ---------------------------------------------------------------------------


class TestConnect:
    @pytest.mark.asyncio
    async def test_connect_sends_session_update(self):
        client = RealtimeClient("sid", AsyncMock())
        ws_mock = make_ws_mock([])
        p_conn, p_cfg = patch_connect(ws_mock)
        with p_conn, p_cfg:
            await client.connect(voice="echo", history=[])
            if client._recv_task:
                client._recv_task.cancel()

        sent_types = [json.loads(c.args[0])["type"] for c in ws_mock.send.call_args_list]
        assert "session.update" in sent_types

    @pytest.mark.asyncio
    async def test_connect_replays_history(self):
        history = [{"role": "user", "content": "Hello"}, {"role": "assistant", "content": "Hi!"}]
        client = RealtimeClient("sid", AsyncMock())
        ws_mock = make_ws_mock([])
        p_conn, p_cfg = patch_connect(ws_mock)
        with p_conn, p_cfg:
            await client.connect(voice="alloy", history=history)
            if client._recv_task:
                client._recv_task.cancel()

        sent_types = [json.loads(c.args[0])["type"] for c in ws_mock.send.call_args_list]
        assert sent_types.count("conversation.item.create") == 2

    @pytest.mark.asyncio
    async def test_connect_raises_on_ws_failure(self):
        client = RealtimeClient("sid", AsyncMock())
        fail_mock = AsyncMock(side_effect=OSError("refused"))
        with patch("pipeline.realtime_client.websockets.connect", new=fail_mock):
            with patch("pipeline.realtime_client.settings", openai_api_key="k", openai_model="m"):
                with pytest.raises(RealtimeClientError):
                    await client.connect()

    @pytest.mark.asyncio
    async def test_connect_truncates_history_to_max_turns(self):
        """History longer than history_max_turns must be sliced to max_turns items."""
        long_history = [{"role": "user", "content": f"msg {i}"} for i in range(30)]
        client = RealtimeClient("sid", AsyncMock())
        ws_mock = make_ws_mock([])
        with patch(
            "pipeline.realtime_client.settings",
            openai_api_key="k",
            openai_model="m",
            history_max_turns=20,
        ):
            with patch("pipeline.realtime_client.websockets.connect", new=AsyncMock(return_value=ws_mock)):
                await client.connect(voice="alloy", history=long_history)
                if client._recv_task:
                    client._recv_task.cancel()
        sent = [json.loads(c.args[0]) for c in ws_mock.send.call_args_list]
        item_creates = [s for s in sent if s.get("type") == "conversation.item.create"]
        assert len(item_creates) == 20

    @pytest.mark.asyncio
    async def test_connect_keeps_most_recent_turns_when_truncating(self):
        """When truncating, the most recent N turns must be kept."""
        history = [{"role": "user", "content": f"msg {i}"} for i in range(25)]
        client = RealtimeClient("sid", AsyncMock())
        ws_mock = make_ws_mock([])
        with patch(
            "pipeline.realtime_client.settings",
            openai_api_key="k",
            openai_model="m",
            history_max_turns=5,
        ):
            with patch("pipeline.realtime_client.websockets.connect", new=AsyncMock(return_value=ws_mock)):
                await client.connect(voice="alloy", history=history)
                if client._recv_task:
                    client._recv_task.cancel()
        sent = [json.loads(c.args[0]) for c in ws_mock.send.call_args_list]
        item_creates = [s for s in sent if s.get("type") == "conversation.item.create"]
        assert len(item_creates) == 5
        texts = [i["item"]["content"][0]["text"] for i in item_creates]
        assert texts == [f"msg {i}" for i in range(20, 25)]


# ---------------------------------------------------------------------------
# send_audio() / flush()
# ---------------------------------------------------------------------------


class TestAudioForwarding:
    @pytest.mark.asyncio
    async def test_send_audio_encodes_as_base64(self):
        client = RealtimeClient("sid", AsyncMock())
        ws_mock = make_ws_mock([])
        p_conn, p_cfg = patch_connect(ws_mock)
        with p_conn, p_cfg:
            await client.connect()
            ws_mock.send.reset_mock()
            pcm = b"\x00\x01\x02\x03"
            await client.send_audio(pcm)

        args = json.loads(ws_mock.send.call_args_list[-1].args[0])
        assert args["type"] == "input_audio_buffer.append"
        assert base64.b64decode(args["audio"]) == pcm

    @pytest.mark.asyncio
    async def test_flush_sends_commit_and_create(self):
        client = RealtimeClient("sid", AsyncMock())
        ws_mock = make_ws_mock([])
        p_conn, p_cfg = patch_connect(ws_mock)
        with p_conn, p_cfg:
            await client.connect()
            ws_mock.send.reset_mock()
            await client.flush()

        sent_types = [json.loads(c.args[0])["type"] for c in ws_mock.send.call_args_list]
        assert "input_audio_buffer.commit" in sent_types
        assert "response.create" in sent_types


# ---------------------------------------------------------------------------
# Event forwarding via recv loop
# ---------------------------------------------------------------------------


class TestEventForwarding:
    @pytest.mark.asyncio
    async def test_audio_delta_forwarded_as_binary(self):
        audio_data = b"\xAB\xCD"
        events = [{"type": "response.audio.delta", "delta": b64(audio_data)}]
        client = RealtimeClient("sid", AsyncMock())
        sent = await collect_sent(client, events)

        audio_msgs = [m for m in sent if m.get("type") == "__audio_bytes__"]
        assert len(audio_msgs) == 1
        assert audio_msgs[0]["bytes"] == audio_data

    @pytest.mark.asyncio
    async def test_transcript_delta_sends_partial(self):
        events = [
            {"type": "response.audio_transcript.delta", "delta": "Hello "},
            {"type": "response.audio_transcript.delta", "delta": "world"},
        ]
        client = RealtimeClient("sid", AsyncMock())
        sent = await collect_sent(client, events)

        partials = [m for m in sent if m.get("type") == "transcript.partial"]
        assert len(partials) == 2
        assert partials[-1]["text"] == "Hello world"

    @pytest.mark.asyncio
    async def test_response_done_sends_final_and_response_end(self):
        events = [
            {"type": "response.audio_transcript.delta", "delta": "Hi there"},
            {"type": "response.done"},
        ]
        client = RealtimeClient("sid", AsyncMock())
        sent = await collect_sent(client, events)

        finals = [m for m in sent if m.get("type") == "transcript.final"]
        ends = [m for m in sent if m.get("type") == "response.end"]
        assert len(finals) == 1
        assert finals[0]["text"] == "Hi there"
        assert len(ends) == 1

    @pytest.mark.asyncio
    async def test_transcript_partial_includes_is_final_false(self):
        events = [{"type": "response.audio_transcript.delta", "delta": "Hi"}]
        client = RealtimeClient("sid", AsyncMock())
        sent = await collect_sent(client, events)
        partials = [m for m in sent if m.get("type") == "transcript.partial"]
        assert partials[0]["is_final"] is False

    @pytest.mark.asyncio
    async def test_transcript_final_includes_is_final_true(self):
        events = [
            {"type": "response.audio_transcript.delta", "delta": "Hi"},
            {"type": "response.done"},
        ]
        client = RealtimeClient("sid", AsyncMock())
        sent = await collect_sent(client, events)
        finals = [m for m in sent if m.get("type") == "transcript.final"]
        assert finals[0]["is_final"] is True

    @pytest.mark.asyncio
    async def test_response_done_resets_transcript_accumulator(self):
        events = [
            {"type": "response.audio_transcript.delta", "delta": "Turn 1"},
            {"type": "response.done"},
            {"type": "response.audio_transcript.delta", "delta": "Turn 2"},
            {"type": "response.done"},
        ]
        client = RealtimeClient("sid", AsyncMock())
        sent = await collect_sent(client, events)

        finals = [m for m in sent if m.get("type") == "transcript.final"]
        assert finals[0]["text"] == "Turn 1"
        assert finals[1]["text"] == "Turn 2"


# ---------------------------------------------------------------------------
# Tool calls
# ---------------------------------------------------------------------------


class TestToolCalls:
    @pytest.mark.asyncio
    async def test_tool_call_sends_function_output_and_response_create(self):
        events = [{
            "type": "response.function_call_arguments.done",
            "call_id": "call_abc",
            "name": "lookup_order_status",
            "arguments": json.dumps({"order_id": "ORD-123"}),
        }]
        client = RealtimeClient("sid", AsyncMock())
        ws_mock = make_ws_mock(events)
        p_conn, p_cfg = patch_connect(ws_mock)
        with p_conn, p_cfg:
            await client.connect()
            if client._recv_task:
                try:
                    await asyncio.wait_for(client._recv_task, timeout=2.0)
                except asyncio.TimeoutError:
                    pass

        sent_types = [json.loads(c.args[0])["type"] for c in ws_mock.send.call_args_list]
        assert "conversation.item.create" in sent_types
        assert "response.create" in sent_types

    @pytest.mark.asyncio
    async def test_unknown_tool_returns_error_result(self):
        events = [{
            "type": "response.function_call_arguments.done",
            "call_id": "call_xyz",
            "name": "nonexistent_tool",
            "arguments": "{}",
        }]
        client = RealtimeClient("sid", AsyncMock())
        ws_mock = make_ws_mock(events)
        p_conn, p_cfg = patch_connect(ws_mock)
        with p_conn, p_cfg:
            await client.connect()
            if client._recv_task:
                try:
                    await asyncio.wait_for(client._recv_task, timeout=2.0)
                except asyncio.TimeoutError:
                    pass

        items = [
            json.loads(c.args[0])
            for c in ws_mock.send.call_args_list
            if json.loads(c.args[0]).get("type") == "conversation.item.create"
        ]
        # The handler should have sent a function_call_output with an error message
        last_output = items[-1].get("item", {}).get("output", "")
        assert "error" in last_output


# ---------------------------------------------------------------------------
# Error events
# ---------------------------------------------------------------------------


class TestErrorEvents:
    @pytest.mark.asyncio
    async def test_openai_api_error_non_fatal(self):
        events = [{"type": "error", "code": "server_error", "message": "Something went wrong"}]
        client = RealtimeClient("sid", AsyncMock())
        sent = await collect_sent(client, events)

        errors = [m for m in sent if m.get("type") == "error"]
        assert errors[0]["code"] == "OPENAI_API_ERROR"
        assert errors[0]["fatal"] is False

    @pytest.mark.asyncio
    async def test_rate_limit_error_is_fatal(self):
        events = [{"type": "error", "code": "rate_limit_exceeded", "message": "Too many requests"}]
        client = RealtimeClient("sid", AsyncMock())
        sent = await collect_sent(client, events)

        errors = [m for m in sent if m.get("type") == "error"]
        assert errors[0]["code"] == "OPENAI_RATE_LIMITED"
        assert errors[0]["fatal"] is True


# ---------------------------------------------------------------------------
# close()
# ---------------------------------------------------------------------------


class TestClose:
    @pytest.mark.asyncio
    async def test_close_cancels_recv_task_and_closes_ws(self):
        client = RealtimeClient("sid", AsyncMock())
        ws_mock = make_ws_mock([])
        p_conn, p_cfg = patch_connect(ws_mock)
        with p_conn, p_cfg:
            await client.connect()
            await client.close()

        ws_mock.close.assert_called_once()
        assert client._ws is None

    @pytest.mark.asyncio
    async def test_close_is_idempotent(self):
        client = RealtimeClient("sid", AsyncMock())
        ws_mock = make_ws_mock([])
        p_conn, p_cfg = patch_connect(ws_mock)
        with p_conn, p_cfg:
            await client.connect()
            await client.close()
            await client.close()  # second close must not raise

    @pytest.mark.asyncio
    async def test_close_logs_ws_close_error(self, caplog):
        import logging
        client = RealtimeClient("sid", AsyncMock())
        ws_mock = make_ws_mock([])
        ws_mock.close = AsyncMock(side_effect=OSError("already closed"))
        p_conn, p_cfg = patch_connect(ws_mock)
        with p_conn, p_cfg:
            await client.connect()
            with caplog.at_level(logging.DEBUG):
                await client.close()
        assert "realtime_ws_close_error" in caplog.text
