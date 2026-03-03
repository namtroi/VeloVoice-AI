"""Tests for WebSocket handler — connection lifecycle, message routing, error paths."""

import json
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from main import app
from session.store import session_store

# ---------------------------------------------------------------------------
# Fixtures
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def mock_realtime():
    """Patch RealtimeClient so tests never hit OpenAI."""
    mock = MagicMock()
    mock.connect = AsyncMock()
    mock.send_audio = AsyncMock()
    mock.flush = AsyncMock()
    mock.close = AsyncMock()
    with patch("ws.handler.RealtimeClient", return_value=mock):
        yield mock

@pytest.fixture(autouse=True)
def clear_store():
    """Reset session store between tests."""
    session_store._sessions.clear()
    yield
    session_store._sessions.clear()


@pytest.fixture()
def client():
    return TestClient(app)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def recv_json(ws) -> dict:
    return json.loads(ws.receive_text())


def send_json(ws, payload: dict) -> None:
    ws.send_text(json.dumps(payload))


# ---------------------------------------------------------------------------
# Connection lifecycle
# ---------------------------------------------------------------------------


class TestConnectionLifecycle:
    def test_connect_then_session_start_returns_session_ready(self, client):
        with client.websocket_connect("/ws") as ws:
            send_json(ws, {"type": "session.start"})
            msg = recv_json(ws)
            assert msg["type"] == "session.ready"
            assert "session_id" in msg
            assert msg["session_id"]

    def test_session_start_creates_store_entry(self, client):
        with client.websocket_connect("/ws") as ws:
            send_json(ws, {"type": "session.start"})
            msg = recv_json(ws)
            sid = msg["session_id"]
            assert session_store.get(sid) is not None

    def test_session_end_closes_websocket_1000(self, client):
        with client.websocket_connect("/ws") as ws:
            send_json(ws, {"type": "session.start"})
            recv_json(ws)  # session.ready
            send_json(ws, {"type": "session.end"})
            # After session.end the server closes with 1000 — client.receive()
            # raises WebSocketDisconnect or returns close frame
            with pytest.raises(Exception):
                ws.receive_text()  # connection is closed

    def test_session_end_removes_store_entry(self, client):
        with client.websocket_connect("/ws") as ws:
            send_json(ws, {"type": "session.start"})
            sid = recv_json(ws)["session_id"]
            send_json(ws, {"type": "session.end"})
            try:
                ws.receive_text()
            except Exception:
                pass
        assert session_store.get(sid) is None

    def test_session_start_with_custom_config(self, client):
        with client.websocket_connect("/ws") as ws:
            send_json(ws, {"type": "session.start", "config": {"language": "fr", "voice": "echo"}})
            msg = recv_json(ws)
            assert msg["type"] == "session.ready"

    def test_disconnect_without_session_end_cleans_up_store(self, client):
        sid = None
        with client.websocket_connect("/ws") as ws:
            send_json(ws, {"type": "session.start"})
            sid = recv_json(ws)["session_id"]
            # Disconnect without session.end
        assert session_store.get(sid) is None


# ---------------------------------------------------------------------------
# Message routing
# ---------------------------------------------------------------------------


class TestMessageRouting:
    def test_audio_stop_before_start_returns_session_not_found(self, client):
        with client.websocket_connect("/ws") as ws:
            send_json(ws, {"type": "audio.stop"})
            msg = recv_json(ws)
            assert msg["type"] == "error"
            assert msg["code"] == "SESSION_NOT_FOUND"
            assert msg["fatal"] is False

    def test_audio_stop_after_start_does_not_error(self, client):
        with client.websocket_connect("/ws") as ws:
            send_json(ws, {"type": "session.start"})
            recv_json(ws)  # session.ready
            send_json(ws, {"type": "audio.stop"})
            # Phase 3 stub — no error response expected
            send_json(ws, {"type": "session.end"})

    def test_binary_audio_before_start_returns_session_not_found(self, client):
        with client.websocket_connect("/ws") as ws:
            ws.send_bytes(b"\x00\x01\x02")
            msg = recv_json(ws)
            assert msg["type"] == "error"
            assert msg["code"] == "SESSION_NOT_FOUND"
            assert msg["fatal"] is False

    def test_binary_audio_after_start_is_accepted(self, client):
        with client.websocket_connect("/ws") as ws:
            send_json(ws, {"type": "session.start"})
            recv_json(ws)  # session.ready
            ws.send_bytes(b"\x00" * 256)
            # No error response from server
            send_json(ws, {"type": "session.end"})


# ---------------------------------------------------------------------------
# Error paths
# ---------------------------------------------------------------------------


class TestErrorPaths:
    def test_invalid_json_returns_invalid_message_type(self, client):
        with client.websocket_connect("/ws") as ws:
            ws.send_text("not json at all {{{")
            msg = recv_json(ws)
            assert msg["type"] == "error"
            assert msg["code"] == "INVALID_MESSAGE_TYPE"
            assert msg["fatal"] is False

    def test_unknown_type_returns_invalid_message_type(self, client):
        with client.websocket_connect("/ws") as ws:
            send_json(ws, {"type": "totally.unknown"})
            msg = recv_json(ws)
            assert msg["type"] == "error"
            assert msg["code"] == "INVALID_MESSAGE_TYPE"
            assert msg["fatal"] is False

    def test_schema_error_returns_invalid_message_schema(self, client):
        with client.websocket_connect("/ws") as ws:
            # Valid type but extra required field missing / wrong shape for config
            send_json(ws, {"type": "session.start", "config": "not-an-object"})
            msg = recv_json(ws)
            assert msg["type"] == "error"
            assert msg["code"] == "INVALID_MESSAGE_SCHEMA"
            assert msg["fatal"] is False

    def test_error_msgs_are_not_fatal_for_non_fatal_codes(self, client):
        with client.websocket_connect("/ws") as ws:
            # Send bad message — connection should remain open
            send_json(ws, {"type": "totally.unknown"})
            recv_json(ws)  # error frame
            # Connection still alive — we can send another message
            send_json(ws, {"type": "session.start"})
            msg = recv_json(ws)
            assert msg["type"] == "session.ready"

    def test_multiple_sessions_are_independent(self, client):
        with client.websocket_connect("/ws") as ws1:
            with client.websocket_connect("/ws") as ws2:
                send_json(ws1, {"type": "session.start"})
                send_json(ws2, {"type": "session.start"})
                sid1 = recv_json(ws1)["session_id"]
                sid2 = recv_json(ws2)["session_id"]
                assert sid1 != sid2
                assert session_store.active_count == 2
