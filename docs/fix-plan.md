---
title: "VeloVoice AI — Code Review Fix Plan"
status: pending
priority: P1
effort: "3-4 days (16 issues across 3 phases)"
created: 2026-03-03
---

# VeloVoice AI — Code Review Fix Plan

This plan addresses all 16 issues identified in the post-Phase-7 code review, resolves 3 open
architecture questions, and specifies exactly what to change in each file. Fixes are grouped into
three phases ordered by severity. Each phase can be committed independently.

---

## Open Questions — Decisions

These must be resolved before implementation begins. Decisions are definitive.

### Q1: 24 kHz vs 16 kHz?

**Decision: use 24 kHz throughout. Update `api-contract.md` to match the code.**

Rationale: GPT-4o Realtime explicitly recommends 24 kHz for best quality. The code, both
`AudioCapture` and `AudioPlayback`, already uses `sampleRate: 24000`. The `session.update` event
sends `pcm16` with no explicit rate field — OpenAI infers it from the connected session. Changing
to 16 kHz would require resampling in the browser (adding complexity) and would degrade output
quality with no measurable latency benefit. The doc was written before the code and used the wrong
value. Fix the doc, keep the code.

### Q2: language field — remove or implement?

**Decision: remove from `SessionStartConfig` and from `api-contract.md`.**

Rationale: OpenAI Realtime does not accept a `language` parameter in `session.update` (it uses
`input_audio_transcription.language` only when transcription mode is enabled, which is separate
from the speech-to-speech pipeline). Forwarding an unsupported field would either be silently
ignored or cause an API error. YAGNI — remove it now, add back properly if/when transcription
mode is needed.

### Q3: openai package in requirements.txt — keep or remove?

**Decision: remove from `requirements.txt`.**

Rationale: The codebase uses `websockets` directly. The `openai` SDK is not imported anywhere in
source. Keeping an unused 1.x SDK adds ~20 MB of transitive deps, increases attack surface, and
misleads future maintainers. If the project migrates to the SDK later, re-add with intent.

---

## Phase 1 — Critical (CI-blocking)

Target: unblock CI from day 1. Two fixes.

### Fix 1 — `backend/config.py`: defer Settings() instantiation so tests can run without a real API key

**File:** `backend/config.py`

**Problem:** `settings = Settings()` executes at module import time. `Settings` has a required
`openai_api_key: str` field with no default. In CI with no `.env` and no `OPENAI_API_KEY`
environment variable, every import of `config` raises `ValidationError`, causing the entire test
suite to fail before a single test runs.

**Fix:** Replace the module-level eager instantiation with a lazy proxy. All callers that
currently do `from config import settings` keep working — they get the singleton on first
attribute access instead of at import time.

```python
# backend/config.py  (final state)
from __future__ import annotations

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    openai_api_key: str = ""          # empty default allows import without key
    openai_model: str = "gpt-4o-realtime-preview"
    session_ttl_seconds: int = 1800
    history_max_turns: int = 20


@lru_cache(maxsize=1)
def get_settings() -> Settings:
    \"\"\"Return the singleton Settings instance (lazy, cached).\"\"\"
    return Settings()


# Backwards-compatible alias so existing `from config import settings` still works.
# The proxy delegates attribute access to the real singleton on first use.
class _SettingsProxy:
    def __getattr__(self, name: str):
        return getattr(get_settings(), name)

    def __setattr__(self, name: str, value):
        setattr(get_settings(), name, value)


settings = _SettingsProxy()
```

Why `_SettingsProxy` instead of `settings = get_settings()`: A plain call would still execute at
import time, defeating the purpose. The proxy delays real `Settings()` construction to the first
attribute access. All existing callsites (`settings.openai_api_key`, etc.) require zero changes.

Impact on tests: `conftest.py` can set `OPENAI_API_KEY` in the environment before any attribute
on `settings` is accessed. The existing `test_realtime_client.py` patches
`pipeline.realtime_client.settings` directly, so it is unaffected.

CI: Add `OPENAI_API_KEY=ci-placeholder` to the CI environment (GitHub Actions secret or
workflow env). The placeholder is never sent to OpenAI because all tests that touch OpenAI WS
mock it via `patch_connect`.

---

### Fix 2 — `frontend/package.json`: add test script

**File:** `frontend/package.json`

**Problem:** `npm test` fails with `Missing script: "test"`. The project already has `vitest` and
`vitest.config.ts` installed and configured — only the script entry is missing.

**Fix:** Add two entries to the `"scripts"` block:

```json
{
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "lint": "eslint .",
    "preview": "vite preview",
    "test": "vitest run",
    "test:watch": "vitest"
  }
}
```

`vitest run` is the CI-appropriate single-pass mode. `test:watch` is the interactive dev mode.

---

## Phase 2 — High (correctness and reliability)

Target: eliminate silent errors, fix Docker networking, correct audio contract, enforce history
limit.

### Fix 3 — `backend/pipeline/realtime_client.py` `close()`: log the swallowed exception

**File:** `backend/pipeline/realtime_client.py`, lines 149-153

**Problem:** `except Exception: pass` in `close()` silently discards WS close errors. If the
OpenAI WebSocket close fails (e.g., connection already dropped, SSL teardown error), there is no
observability.

**Current code:**
```python
if self._ws:
    try:
        await self._ws.close()
    except Exception:
        pass
    self._ws = None
```

**Fix:** Log at `debug` level. Close errors are expected on abrupt disconnects — they should not
alert, but must be visible in traces:

```python
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
```

---

### Fix 4 — `backend/ws/handler.py` fatal error path: log the swallowed exception

**File:** `backend/ws/handler.py`, lines 173-177

**Problem:** In the `except Exception` handler at the top level, the code correctly logs and
tries to send an error message, but the inner `except Exception: pass` silently discards WS send
or close failures. If `_send_json` or `ws.close` raises (e.g., WS already closed), the swallowed
exception produces no trace.

**Current code:**
```python
    except Exception:  # noqa: BLE001
        log.exception("ws_internal_error", ...)
        try:
            await _send_json(ws, error_msg(...))
            await ws.close(code=1011)
        except Exception:
            pass
```

**Fix:**
```python
    except Exception:  # noqa: BLE001
        log.exception(
            "ws_internal_error",
            extra={"action": "pipeline_error", "session_id": session_id},
        )
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
```

---

### Fix 5 — `docs/api-contract.md`: update audio sample rate to 24 kHz (Q1 resolution)

**File:** `docs/api-contract.md`

**Problem:** Sections 1, 3, 4, and 7 all say 16 kHz. The code uses 24 kHz. Doc is wrong; code
is right per Q1 decision.

**Exact changes:**

Section 1 "Audio Format (Global)":
- Before: `PCM signed 16-bit little-endian, 16 kHz, mono`
- After: `PCM signed 16-bit little-endian, 24 kHz, mono`

Section 7 table:
- Before: `| Sample rate | 16,000 Hz | Required by OpenAI Realtime API |`
- After: `| Sample rate | 24,000 Hz | Recommended by OpenAI for gpt-4o-realtime |`
- Before: `Bytes per second: 16,000 samples x 2 bytes = 32,000 bytes/s (~31 KB/s)`
- After: `Bytes per second: 24,000 samples x 2 bytes = 48,000 bytes/s (~47 KB/s)`

Section 3 audio.chunk description:
- Before: `PCM signed 16-bit LE, 16 kHz, mono`
- After: `PCM signed 16-bit LE, 24 kHz, mono`

Section 4 response.audio description:
- Before: `Same PCM format as input audio: 16-bit LE, 16 kHz, mono`
- After: `Same PCM format as input audio: 16-bit LE, 24 kHz, mono`

Also update `docs/architecture.md` wherever the audio format is referenced.

---

### Fix 6 — `frontend/vite.config.ts`: make proxy target configurable for Docker

**File:** `frontend/vite.config.ts`

**Problem:** The Vite proxy hardcodes `ws://localhost:8000`. Inside Docker Compose, the frontend
container must reach the backend via the service hostname `backend`, not `localhost`. The current
config breaks Docker networking.

**Fix:** Read the target from an environment variable with a localhost default:

```typescript
// frontend/vite.config.ts
import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

// VITE_BACKEND_WS_TARGET: set to "ws://backend:8000" in Docker.
// Defaults to localhost for direct npm run dev usage.
const backendWsTarget = process.env.VITE_BACKEND_WS_TARGET ?? 'ws://localhost:8000'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  server: {
    port: 3000,
    proxy: {
      '/ws': {
        target: backendWsTarget,
        ws: true,
      },
    },
  },
})
```

**Also update `docker-compose.yml`** frontend service to pass the env var. This change is
combined with Fix 11 (Docker `depends_on` condition):

```yaml
frontend:
  build:
    context: ./frontend
    dockerfile: Dockerfile
  ports:
    - "3000:3000"
  env_file:
    - .env
  environment:
    - VITE_BACKEND_WS_TARGET=ws://backend:8000
  volumes:
    - ./frontend:/app
    - /app/node_modules
  depends_on:
    backend:
      condition: service_healthy
```

---

### Fix 7 — `backend/pipeline/realtime_client.py`: enforce `history_max_turns`

**File:** `backend/pipeline/realtime_client.py`, `connect()` method, lines 107-116

**Problem:** `history_max_turns` is defined in `Settings` and documented as "Last 20 turns used
as context (configurable)", but `connect()` replays the entire `history` list without truncation.

**Fix:** Slice history before the replay loop:

```python
async def connect(self, voice: str = "alloy", history: list[dict] = None) -> None:
    \"\"\"Open the OpenAI Realtime WebSocket and start the recv loop.\"\"\"
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
    # ... rest of method unchanged
```

`history[-max_turns:]` keeps the most recent turns, which is the correct semantic for LLM context
windows.

---

## Phase 3 — Medium and Low (correctness, cleanup, lint)

### Fix 8 — `frontend/src/App.tsx`: fix `onTranscriptFinal` role

**File:** `frontend/src/App.tsx`, line 63

**Problem:** `onTranscriptFinal` receives the assistant's speech transcript (from
`response.audio_transcript.delta` events). The handler mislabels it `'user'`, causing every
assistant response to appear as a blue right-side bubble labelled "You".

**Current code:**
```typescript
onTranscriptFinal(text: string) {
  addMessage('user', text)   // WRONG — this is the assistant speaking
  setStatus('connected')
},
```

**Fix:**
```typescript
onTranscriptFinal(text: string) {
  addMessage('assistant', text)
  setStatus('connected')
},
```

---

### Fix 9 — `backend/session/store.py`: remove unused `asyncio.Lock`

**File:** `backend/session/store.py`

**Problem:** `self._lock = asyncio.Lock()` is created in `__init__` but never acquired anywhere
in the class. It is dead code that misleads readers into thinking concurrent access is protected.

**Decision: remove the lock.** Pure Python dict operations are GIL-protected and effectively
atomic within a single asyncio event loop. A lock that is never acquired is worse than no lock
because it implies false safety. If true concurrency isolation is needed, the correct fix is a
proper async-safe store, not a half-measure.

```python
# __init__ method

# BEFORE
def __init__(self) -> None:
    self._sessions: dict[str, SessionData] = {}
    self._lock = asyncio.Lock()

# AFTER
def __init__(self) -> None:
    self._sessions: dict[str, SessionData] = {}
```

Keep `import asyncio` — it is still used by `cleanup_expired()` for `asyncio.sleep()`.

---

### Fix 10 — `backend/ws/message_types.py` and `frontend/src/lib/ws-client.ts`: add `is_final` field

**Problem:** `api-contract.md` specifies `is_final: false` on `transcript.partial` and
`is_final: true` on `transcript.final`. Both the backend builders and the frontend Zod schemas
omit this field.

**File A — `backend/ws/message_types.py`:**

```python
# BEFORE
def transcript_partial(text: str, session_id: str | None = None) -> dict:
    return {"type": "transcript.partial", "text": text, "session_id": session_id}

def transcript_final(text: str, session_id: str | None = None) -> dict:
    return {"type": "transcript.final", "text": text, "session_id": session_id}

# AFTER
def transcript_partial(text: str, session_id: str | None = None) -> dict:
    return {"type": "transcript.partial", "text": text, "is_final": False, "session_id": session_id}

def transcript_final(text: str, session_id: str | None = None) -> dict:
    return {"type": "transcript.final", "text": text, "is_final": True, "session_id": session_id}
```

**File B — `frontend/src/lib/ws-client.ts`:**

```typescript
// BEFORE
const TranscriptPartialSchema = z.object({
  type: z.literal('transcript.partial'),
  text: z.string(),
})

const TranscriptFinalSchema = z.object({
  type: z.literal('transcript.final'),
  text: z.string(),
})

// AFTER
const TranscriptPartialSchema = z.object({
  type: z.literal('transcript.partial'),
  text: z.string(),
  is_final: z.literal(false),
})

const TranscriptFinalSchema = z.object({
  type: z.literal('transcript.final'),
  text: z.string(),
  is_final: z.literal(true),
})
```

---

### Fix 11 — `docker-compose.yml`: `depends_on` with `condition: service_healthy`

**File:** `docker-compose.yml`

**Problem:** `depends_on: - backend` waits for the container to *start*, not for it to be
*healthy*. The backend healthcheck block already exists. The fix is using the long-form
`depends_on` syntax.

The full corrected frontend service block is shown in Fix 6 above.

---

### Fix 12 — `frontend/src/lib/audio-utils.ts` and `frontend/src/lib/vad.ts`: fix ESLint errors

**File A — `frontend/src/lib/audio-utils.ts`, line 16:**

ESLint error: `prefer-const` — `let s` is never reassigned.

```typescript
// BEFORE
let s = Math.max(-1, Math.min(1, float32Array[i])) // clamp

// AFTER
const s = Math.max(-1, Math.min(1, float32Array[i])) // clamp
```

**File B — `frontend/src/lib/vad.ts`, line 23:**

ESLint error: unused parameter `audio`. The VAD library passes the captured audio buffer, but
`VadController` discards it intentionally — audio capture is handled separately by `AudioCapture`.
Fix with an underscore prefix to signal intentional non-use:

```typescript
// BEFORE
onSpeechEnd: (audio: Float32Array) => {
  onSpeechEnd()
},

// AFTER
onSpeechEnd: (_audio: Float32Array) => {
  onSpeechEnd()
},
```

---

### Fix 13 — `backend/tests/conftest.py`: resolve the TODO — add shared fixtures

**File:** `backend/tests/conftest.py`

**Problem:** The file contains only a TODO comment. Fixtures that are duplicated across test
files (`clear_store`, settings patching) should live here.

**Fix:** Replace the TODO with three shared fixtures:

```python
\"\"\"Pytest configuration and shared fixtures.\"\"\"

import os

import pytest
from unittest.mock import AsyncMock, MagicMock, patch

from session.store import session_store


@pytest.fixture(autouse=True)
def clear_session_store():
    \"\"\"Reset session store between every test to prevent state bleed.\"\"\"
    session_store._sessions.clear()
    yield
    session_store._sessions.clear()


@pytest.fixture()
def mock_realtime_client():
    \"\"\"Patch RealtimeClient so tests never hit OpenAI.

    Yields the mock instance for assertion. Not autouse — tests opt in explicitly.
    \"\"\"
    mock = MagicMock()
    mock.connect = AsyncMock()
    mock.send_audio = AsyncMock()
    mock.flush = AsyncMock()
    mock.close = AsyncMock()
    with patch("ws.handler.RealtimeClient", return_value=mock):
        yield mock


@pytest.fixture(autouse=True)
def stub_openai_api_key(monkeypatch):
    \"\"\"Ensure OPENAI_API_KEY is always set so Settings() never raises in tests.\"\"\"
    monkeypatch.setenv("OPENAI_API_KEY", os.environ.get("OPENAI_API_KEY", "ci-test-placeholder"))
```

After adding `clear_session_store` to conftest.py, remove the duplicate `clear_store` fixture
from `test_ws_handler.py`. Keep the local `mock_realtime` fixture in `test_ws_handler.py` since
it uses `autouse=True` scoped to that file, which differs from the opt-in conftest fixture.

---

### Fix 14 — `frontend/src/components/transcript-panel.tsx`: replace array index key with stable id

**Problem:** `key={i}` uses array index. If messages are reordered or deleted, React will
re-render the wrong components.

**File A — `frontend/src/stores/session-store.ts`:** Add `id` field to `Message`:

```typescript
// Add at module scope, before the create() call
let _messageId = 0

// Update Message interface
export interface Message {
  id: number
  role: 'user' | 'assistant'
  text: string
}

// Update addMessage action inside create()
addMessage: (role, text) =>
  set((s) => ({
    transcript: [...s.transcript, { id: _messageId++, role, text }],
  })),
```

**File B — `frontend/src/components/transcript-panel.tsx`, line 51:**

```typescript
// BEFORE
{transcript.map((msg, i) => (
  <div key={i} ...>

// AFTER
{transcript.map((msg) => (
  <div key={msg.id} ...>
```

---

### Fix 15 — `backend/ws/message_types.py` and `docs/api-contract.md`: remove `language` field (Q2)

**File A — `backend/ws/message_types.py`:**

```python
# BEFORE
class SessionStartConfig(BaseModel):
    language: str = "en"
    voice: str = "alloy"

# AFTER — add ConfigDict to silently ignore unknown fields from old clients
from pydantic import BaseModel, ConfigDict

class SessionStartConfig(BaseModel):
    model_config = ConfigDict(extra="ignore")
    voice: str = "alloy"
```

**File B — `docs/api-contract.md`, Section 3 `session.start`:**

Remove `language` from the JSON example:
```json
{
  "type": "session.start",
  "config": {
    "voice": "alloy"
  }
}
```

Remove the `config.language` row from the Fields table entirely.

Note: `ws-client.ts` sends `config: {}` which already omits `language` — no frontend change
needed. Old clients that send `language` will have it silently ignored via `extra="ignore"`.

---

### Fix 16 — `backend/requirements.txt`: remove unused `openai` package (Q3)

**File:** `backend/requirements.txt`

Remove `openai==1.59.5`. Final file:

```text
fastapi==0.115.6
uvicorn[standard]==0.32.1
websockets==13.1
pydantic-settings==2.7.0
httpx==0.28.1
pytest==8.3.4
pytest-asyncio==0.25.0
```

After removing, rebuild the Docker image and run `python -c "import main"` to verify no import
errors.

---

## Docs Impact

| Document | Change | Phase |
|---|---|---|
| `docs/api-contract.md` | Fix sample rate: 16 kHz → 24 kHz in Sections 1, 3, 4, 7 | 2 |
| `docs/api-contract.md` | Remove `language` field from `session.start` config spec | 3 |
| `docs/api-contract.md` | Add `is_final` field to `transcript.partial` and `transcript.final` specs | 3 |
| `docs/architecture.md` | Update audio format references (16 kHz → 24 kHz) | 2 |
| `docs/architecture.md` | Remove `language` from `SessionStartConfig` schema in Section 5 | 3 |
| `docs/fix-plan.md` | This document (created) | — |

All doc changes must land in the same commit as the corresponding code change (Three Pillars).

---

## Test Strategy

### Phase 1 tests

**Fix 1 (config lazy load)** — new file `backend/tests/test_config.py`:

```python
def test_settings_can_be_imported_without_api_key(monkeypatch):
    monkeypatch.delenv("OPENAI_API_KEY", raising=False)
    from config import settings  # must not raise
    assert settings is not None

def test_settings_proxy_reads_env_var(monkeypatch):
    monkeypatch.setenv("OPENAI_API_KEY", "sk-test")
    import importlib, config as cfg
    importlib.reload(cfg)
    assert cfg.settings.openai_api_key == "sk-test"
```

**Fix 2 (npm test script)** — no new test file; verify by running `npm test` in CI.

### Phase 2 tests

**Fix 3 (silent close exception)** — add to `TestClose` in `test_realtime_client.py`:

```python
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
```

**Fix 4 (silent handler exception)** — add to `TestErrorPaths` in `test_ws_handler.py`. Test
that a forced internal error still produces a `ws_close_after_error_failed` debug log when
`ws.close(1011)` subsequently raises.

**Fix 7 (history truncation)** — add to `TestConnect` in `test_realtime_client.py`:

```python
async def test_connect_truncates_history_to_max_turns(self):
    long_history = [{"role": "user", "content": f"msg {i}"} for i in range(30)]
    client = RealtimeClient("sid", AsyncMock())
    ws_mock = make_ws_mock([])
    p_conn, p_cfg = patch_connect(ws_mock)
    with p_conn, p_cfg:
        await client.connect(voice="alloy", history=long_history)
        if client._recv_task:
            client._recv_task.cancel()
    sent = [json.loads(c.args[0]) for c in ws_mock.send.call_args_list]
    item_creates = [s for s in sent if s.get("type") == "conversation.item.create"]
    assert len(item_creates) == 20  # settings.history_max_turns default

async def test_connect_keeps_most_recent_turns_when_truncating(self):
    history = [{"role": "user", "content": f"msg {i}"} for i in range(25)]
    client = RealtimeClient("sid", AsyncMock())
    ws_mock = make_ws_mock([])
    with patch("pipeline.realtime_client.settings",
               openai_api_key="k", openai_model="m", history_max_turns=5):
        with patch("pipeline.realtime_client.websockets.connect",
                   new=AsyncMock(return_value=ws_mock)):
            await client.connect(voice="alloy", history=history)
            if client._recv_task:
                client._recv_task.cancel()
    sent = [json.loads(c.args[0]) for c in ws_mock.send.call_args_list]
    item_creates = [s for s in sent if s.get("type") == "conversation.item.create"]
    assert len(item_creates) == 5
    # Verify the last 5 messages were kept (msg 20-24)
    texts = [i["item"]["content"][0]["text"] for i in item_creates]
    assert texts == [f"msg {i}" for i in range(20, 25)]
```

### Phase 3 tests

**Fix 8 (role mislabel)** — add to `frontend/src/tests/session-store.test.ts`:

```typescript
it('addMessage with role assistant stores assistant role', () => {
  const { addMessage } = useSessionStore.getState()
  addMessage('assistant', 'Hello from AI')
  const { transcript } = useSessionStore.getState()
  expect(transcript.at(-1)?.role).toBe('assistant')
})
```

**Fix 9 (dead lock)** — add to `test_session.py`:

```python
def test_session_store_has_no_lock():
    store = SessionStore()
    assert not hasattr(store, '_lock')
```

**Fix 10 (`is_final` field)** — add to `TestEventForwarding` in `test_realtime_client.py`:

```python
async def test_transcript_partial_includes_is_final_false(self):
    events = [{"type": "response.audio_transcript.delta", "delta": "Hi"}]
    client = RealtimeClient("sid", AsyncMock())
    sent = await collect_sent(client, events)
    partials = [m for m in sent if m.get("type") == "transcript.partial"]
    assert partials[0]["is_final"] is False

async def test_transcript_final_includes_is_final_true(self):
    events = [
        {"type": "response.audio_transcript.delta", "delta": "Hi"},
        {"type": "response.done"},
    ]
    client = RealtimeClient("sid", AsyncMock())
    sent = await collect_sent(client, events)
    finals = [m for m in sent if m.get("type") == "transcript.final"]
    assert finals[0]["is_final"] is True
```

Add to `ws-client.test.ts`:

```typescript
it('rejects transcript.partial message missing is_final', () => {
  const result = ServerMessageSchema.safeParse({ type: 'transcript.partial', text: 'hi' })
  expect(result.success).toBe(false)
})
```

**Fix 11 (Docker depends_on)** — manual smoke test only: `docker-compose down && docker-compose
up`, verify frontend loads without backend-not-ready errors.

**Fix 12 (ESLint errors)** — run `npm run lint` and verify zero errors. The lint output is the
test.

**Fix 13 (conftest fixtures)** — run full backend test suite after moving fixtures; all tests
must remain green.

**Fix 14 (React key)** — add to a new `transcript-panel.test.tsx`:

```typescript
it('renders correct number of messages', () => {
  const messages = [
    { id: 0, role: 'user' as const, text: 'Hello' },
    { id: 1, role: 'assistant' as const, text: 'Hi' },
  ]
  const { container } = render(
    <TranscriptPanel transcript={messages} status="connected" />
  )
  // Two message bubbles rendered
  expect(container.querySelectorAll('[class*="rounded-2xl"]').length).toBe(2)
})
```

**Fix 15 (remove language)** — update `test_ws_handler.py`:

```python
def test_session_start_with_custom_config(self, client):
    with client.websocket_connect("/ws") as ws:
        send_json(ws, {"type": "session.start", "config": {"voice": "echo"}})
        msg = recv_json(ws)
        assert msg["type"] == "session.ready"

def test_session_start_ignores_unknown_config_fields(self, client):
    # Old clients sending language should not get a schema error
    with client.websocket_connect("/ws") as ws:
        send_json(ws, {"type": "session.start", "config": {"language": "fr", "voice": "echo"}})
        msg = recv_json(ws)
        assert msg["type"] == "session.ready"
```

**Fix 16 (remove openai dep)** — run `pip install -r requirements.txt && python -c "import main"`
in the backend container; verify no import errors.

### Coverage targets

| Layer | Estimated current | Target post-fixes |
|---|---|---|
| Backend unit (pytest) | ~65% | >= 75% |
| Frontend unit (vitest) | ~60% | >= 70% |
| Integration (WS handler) | covered | maintained |

---

## Observability

### New log events introduced

| Action | Level | File | When emitted |
|---|---|---|---|
| `realtime_ws_close_error` | debug | `pipeline/realtime_client.py` | `ws.close()` raises during `RealtimeClient.close()` |
| `ws_close_after_error_failed` | debug | `ws/handler.py` | `_send_json` or `ws.close(1011)` raises in the fatal-error handler |
| `history_truncated` | debug | `pipeline/realtime_client.py` | `len(history) > history_max_turns` at `connect()` time; includes `original` and `max` counts |

### Phase 3 observability

No new log events. ESLint fixes and structural cleanups do not alter observable runtime behavior.

### Health check

No changes to `GET /health`. The existing health check adequately covers liveness.

---

## Implementation Order

```
Day 1  Phase 1  Fix 1 (config lazy load) + Fix 2 (npm test script)   CI unblocked
       Phase 2  Fix 5 (api-contract.md sample rate) + Fix 7 (history truncation)
Day 2  Phase 2  Fix 3 + Fix 4 (silent exceptions — log, do not swallow)
       Phase 2  Fix 6 + Fix 11 combined (Vite proxy env var + Docker depends_on)
Day 3  Phase 3  Fix 8 (role mislabel) + Fix 10 (is_final) + Fix 15 (language) + Fix 16 (openai dep)
       Phase 3  Fix 9 (dead lock) + Fix 12 (ESLint) + Fix 13 (conftest) + Fix 14 (React key)
Day 4  Run full test suite (backend + frontend), npm run lint, Docker smoke test
       Finish remaining doc sections, commit each phase separately, tag
```

Each day's changes should be committed as a single atomic commit per phase so that bisecting is
straightforward.

---

## Unresolved Questions

None. All three open architecture questions have been resolved with explicit decisions above.
