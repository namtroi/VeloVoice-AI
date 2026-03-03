"""Session store — in-memory store for active voice sessions."""

import asyncio
import time
from dataclasses import dataclass, field
from typing import Any, Optional

from config import settings
from observability.logger import get_logger

log = get_logger(__name__)


@dataclass
class SessionData:
    session_id: str
    history: list[dict] = field(default_factory=list)
    created_at: float = field(default_factory=time.time)
    last_active: float = field(default_factory=time.time)
    realtime_client: Any = field(default=None, repr=False)  # RealtimeClient | None


class SessionStore:
    def __init__(self) -> None:
        self._sessions: dict[str, SessionData] = {}
        self._lock = asyncio.Lock()

    def create(self, session_id: str) -> SessionData:
        """Create and register a new session."""
        session = SessionData(session_id=session_id)
        self._sessions[session_id] = session
        log.info(
            "session_created",
            extra={"action": "session_created", "session_id": session_id},
        )
        return session

    def get(self, session_id: str) -> Optional[SessionData]:
        """Return the session or None if it does not exist."""
        return self._sessions.get(session_id)

    def touch(self, session_id: str) -> None:
        """Update last_active timestamp for an existing session."""
        session = self._sessions.get(session_id)
        if session:
            session.last_active = time.time()

    def delete(self, session_id: str) -> None:
        """Remove a session from the store."""
        self._sessions.pop(session_id, None)

    async def cleanup_expired(self) -> None:
        """Background task: run every 60 s, remove sessions idle > TTL."""
        while True:
            await asyncio.sleep(60)
            now = time.time()
            ttl = settings.session_ttl_seconds
            expired = [
                sid
                for sid, s in list(self._sessions.items())
                if (now - s.last_active) > ttl
            ]
            for sid in expired:
                self._sessions.pop(sid, None)
                log.info(
                    "session_expired",
                    extra={"action": "session_expired", "session_id": sid},
                )

    @property
    def active_count(self) -> int:
        return len(self._sessions)


# Module-level singleton
session_store = SessionStore()
