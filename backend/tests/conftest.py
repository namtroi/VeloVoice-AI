"""Pytest configuration and shared fixtures."""

import logging
import os
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from session.store import session_store


@pytest.fixture(autouse=True)
def clear_session_store():
    """Reset session store between every test to prevent state bleed."""
    session_store._sessions.clear()
    yield
    session_store._sessions.clear()


@pytest.fixture()
def mock_realtime_client():
    """Patch RealtimeClient so tests never hit OpenAI.

    Yields the mock instance for assertion. Not autouse — tests opt in explicitly.
    """
    mock = MagicMock()
    mock.connect = AsyncMock()
    mock.send_audio = AsyncMock()
    mock.flush = AsyncMock()
    mock.close = AsyncMock()
    with patch("ws.handler.RealtimeClient", return_value=mock):
        yield mock


@pytest.fixture(autouse=True)
def stub_openai_api_key(monkeypatch):
    """Ensure OPENAI_API_KEY is always set so Settings() never raises in tests."""
    monkeypatch.setenv("OPENAI_API_KEY", os.environ.get("OPENAI_API_KEY", "ci-test-placeholder"))


@pytest.fixture(autouse=True)
def propagate_velovoice_loggers():
    """Enable log propagation during tests so caplog can capture structured log records.

    VeloVoice loggers set propagate=False to avoid duplicate output in production.
    During tests we temporarily re-enable propagation so pytest's caplog handler
    can intercept the records.
    """
    velovoice_logger_prefixes = ("pipeline.", "ws.", "session.", "observability.", "velovoice")
    patched = []
    for name, obj in logging.Logger.manager.loggerDict.items():
        if isinstance(obj, logging.Logger) and any(name.startswith(p) for p in velovoice_logger_prefixes):
            if not obj.propagate:
                obj.propagate = True
                patched.append(obj)
    yield
    for logger in patched:
        logger.propagate = False
