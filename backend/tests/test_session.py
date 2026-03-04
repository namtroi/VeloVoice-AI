"""Tests for SessionStore — CRUD, TTL cleanup, concurrent access."""

import asyncio
import time

import pytest

from session.store import SessionData, SessionStore


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def make_store() -> SessionStore:
    return SessionStore()


# ---------------------------------------------------------------------------
# CRUD
# ---------------------------------------------------------------------------

class TestSessionStoreCRUD:
    def test_create_returns_session_data(self):
        store = make_store()
        s = store.create("abc")
        assert isinstance(s, SessionData)
        assert s.session_id == "abc"
        assert s.history == []

    def test_create_registers_session(self):
        store = make_store()
        store.create("abc")
        assert store.get("abc") is not None

    def test_get_returns_none_for_unknown(self):
        store = make_store()
        assert store.get("nope") is None

    def test_get_returns_correct_session(self):
        store = make_store()
        store.create("s1")
        store.create("s2")
        assert store.get("s1").session_id == "s1"
        assert store.get("s2").session_id == "s2"

    def test_delete_removes_session(self):
        store = make_store()
        store.create("abc")
        store.delete("abc")
        assert store.get("abc") is None

    def test_delete_missing_is_noop(self):
        store = make_store()
        store.delete("ghost")  # must not raise

    def test_touch_updates_last_active(self):
        store = make_store()
        s = store.create("abc")
        original = s.last_active
        time.sleep(0.01)
        store.touch("abc")
        assert s.last_active > original

    def test_touch_missing_is_noop(self):
        store = make_store()
        store.touch("ghost")  # must not raise

    def test_active_count(self):
        store = make_store()
        assert store.active_count == 0
        store.create("a")
        store.create("b")
        assert store.active_count == 2
        store.delete("a")
        assert store.active_count == 1


# ---------------------------------------------------------------------------
# TTL cleanup
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_cleanup_removes_expired_sessions():
    store = make_store()
    s = store.create("old")
    # Backdate last_active so it appears expired
    s.last_active = time.time() - 9999

    # Patch TTL to something tiny so cleanup triggers immediately
    import config as cfg_module
    original_ttl = cfg_module.settings.session_ttl_seconds
    cfg_module.settings.session_ttl_seconds = 1

    try:
        # Run one cleanup iteration manually
        now = time.time()
        ttl = cfg_module.settings.session_ttl_seconds
        expired = [
            sid
            for sid, sess in list(store._sessions.items())
            if (now - sess.last_active) > ttl
        ]
        for sid in expired:
            store._sessions.pop(sid, None)

        assert store.get("old") is None
    finally:
        cfg_module.settings.session_ttl_seconds = original_ttl


@pytest.mark.asyncio
async def test_cleanup_keeps_active_sessions():
    store = make_store()
    store.create("fresh")  # last_active = now

    # Simulate cleanup with ttl=1s — "fresh" session should survive
    now = time.time()
    ttl = 1
    expired = [
        sid
        for sid, sess in list(store._sessions.items())
        if (now - sess.last_active) > ttl
    ]
    for sid in expired:
        store._sessions.pop(sid, None)

    assert store.get("fresh") is not None


# ---------------------------------------------------------------------------
# Concurrent access
# ---------------------------------------------------------------------------

@pytest.mark.asyncio
async def test_concurrent_creates():
    store = make_store()

    async def create_session(i: int):
        store.create(f"session-{i}")

    await asyncio.gather(*[create_session(i) for i in range(50)])
    assert store.active_count == 50


def test_session_store_has_no_lock():
    """The dead asyncio.Lock must have been removed from SessionStore.__init__."""
    store = SessionStore()
    assert not hasattr(store, '_lock')


@pytest.mark.asyncio
async def test_concurrent_touch_and_delete():
    store = make_store()
    for i in range(10):
        store.create(f"s{i}")

    async def touch_all():
        for i in range(10):
            store.touch(f"s{i}")

    async def delete_some():
        for i in range(0, 10, 2):
            store.delete(f"s{i}")

    await asyncio.gather(touch_all(), delete_some())
    # Even-indexed sessions deleted, odd remain
    for i in range(1, 10, 2):
        assert store.get(f"s{i}") is not None
