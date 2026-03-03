---
title: "VeloVoice AI — Implementation Plan"
status: pending
priority: P1
effort: "4–6 sessions"
created: 2026-03-02
---

# VeloVoice AI — Implementation Plan

> Phased build-out of the full voice assistant stack. Follows **Document → Test → Code** order.
> Reference: `docs/architecture.md` (design), `docs/api-contract.md` (WS/HTTP contract).

---

## Table of Contents

1. [Phase 0 — Project Scaffolding](#phase-0--project-scaffolding)
2. [Phase 1 — Backend Foundation](#phase-1--backend-foundation)
3. [Phase 2 — WebSocket Handler](#phase-2--websocket-handler)
4. [Phase 3 — OpenAI Realtime Client](#phase-3--openai-realtime-client)
5. [Phase 4 — Frontend Foundation](#phase-4--frontend-foundation)
6. [Phase 5 — Audio Pipeline](#phase-5--audio-pipeline)
7. [Phase 6 — UI Components](#phase-6--ui-components)
8. [Phase 7 — Integration & Hardening](#phase-7--integration--hardening)
9. [Docs Impact](#docs-impact)
10. [Test Strategy](#test-strategy)
11. [Observability](#observability)
12. [Unresolved Questions](#unresolved-questions)

---

## Phase 0 — Project Scaffolding

**Objective:** Repo structure, Docker Compose, CI skeleton — no business logic.

### Deliverables

- `backend/` directory with empty module stubs
- `frontend/` Vite + React + Tailwind scaffold (`npm create vite`)
- `docker-compose.yml` — 2 services: `backend` (port 8000), `frontend` (port 3000)
- `backend/requirements.txt` with pinned deps: `fastapi`, `uvicorn[standard]`, `websockets`, `pydantic-settings`, `openai`
- `frontend/package.json` with deps: `react`, `react-dom`, `zustand`, `zod`, `@ricky0123/vad-web`, Tailwind CSS
- `.env.example` — `OPENAI_API_KEY=`, `OPENAI_MODEL=gpt-4o-realtime-preview`
- `.gitignore` — `.env`, `__pycache__/`, `node_modules/`, `dist/`

### Directory skeletons

```
backend/
├── main.py              # `app = FastAPI()` only
├── config.py            # Settings class (empty)
├── ws/
│   ├── __init__.py
│   ├── handler.py       # stub
│   └── message-types.py # stub
├── pipeline/
│   ├── __init__.py
│   └── realtime-client.py # stub
├── session/
│   ├── __init__.py
│   └── store.py         # stub
├── observability/
│   ├── __init__.py
│   ├── logger.py        # stub
│   └── health.py        # stub
└── tests/
    ├── conftest.py
    ├── test_ws_handler.py
    └── test_session.py

frontend/
├── index.html
├── vite.config.ts
├── tailwind.config.ts
├── src/
│   ├── main.tsx
│   ├── App.tsx
│   ├── components/
│   │   ├── voice-controls.tsx
│   │   ├── transcript-panel.tsx
│   │   └── audio-visualizer.tsx
│   ├── lib/
│   │   ├── ws-client.ts
│   │   ├── audio-capture.ts
│   │   ├── audio-playback.ts
│   │   └── vad.ts
│   ├── stores/
│   │   └── session-store.ts
│   └── tests/
│       ├── ws-client.test.ts
│       └── session-store.test.ts
```

**Effort:** ~1 hour

---

## Phase 1 — Backend Foundation

**Objective:** FastAPI app boots, config loads from env, health endpoint live.

**Depends on:** Phase 0

### Deliverables

#### `backend/config.py`

```python
from pydantic_settings import BaseSettings

class Settings(BaseSettings):
    openai_api_key: str
    openai_model: str = "gpt-4o-realtime-preview"
    session_ttl_seconds: int = 1800
    history_max_turns: int = 20

    class Config:
        env_file = ".env"

settings = Settings()
```

#### `backend/session/store.py`

- `SessionData` dataclass: `session_id`, `history: list[dict]`, `created_at: float`, `last_active: float`
- `SessionStore` class:
  - `create(session_id)` — add to dict
  - `get(session_id)` — return or `None`
  - `touch(session_id)` — update `last_active`
  - `delete(session_id)` — remove from dict
  - `cleanup_expired()` — async background task, runs every 60s, removes idle > TTL
- `session_store = SessionStore()` — module-level singleton

#### `backend/observability/logger.py`

- Structured JSON logger using Python `logging` + custom `JSONFormatter`
- Fields: `timestamp`, `level`, `action`, `session_id`, `duration_ms`, `metadata`

#### `backend/observability/health.py`

- `GET /health` — FastAPI router
- Checks OpenAI Realtime API reachability (TCP connect to `api.openai.com:443`)
- Returns `200` with `{"status": "healthy", "checks": {...}, "active_sessions": N, "uptime_seconds": N}`
- Returns `503` if unreachable

#### `backend/main.py`

```python
app = FastAPI(title="VeloVoice AI")
app.include_router(health_router)
# WS router added in Phase 2
```

**Tests:** `test_session.py` — CRUD, TTL cleanup, concurrent access.

**Effort:** ~2 hours

---

## Phase 2 — WebSocket Handler

**Objective:** WS endpoint accepts connections, handles `session.start` / `session.end`, validates all JSON frames.

**Depends on:** Phase 1

### Deliverables

#### `backend/ws/message-types.py`

Pydantic models for all client→server message types (see `docs/api-contract.md` §3):

```python
class SessionStartConfig(BaseModel):
    language: str = "en"
    voice: str = "alloy"

class SessionStartMessage(BaseModel):
    type: Literal["session.start"]
    config: SessionStartConfig = SessionStartConfig()

class AudioStopMessage(BaseModel):
    type: Literal["audio.stop"]

class SessionEndMessage(BaseModel):
    type: Literal["session.end"]

ClientMessage = Annotated[
    SessionStartMessage | AudioStopMessage | SessionEndMessage,
    Field(discriminator="type")
]
```

Server→client message builders (dict helpers, not Pydantic — sent as `json.dumps`):

- `session_ready(session_id)` → `{"type": "session.ready", "session_id": ...}`
- `transcript_partial(text)` → `{"type": "transcript.partial", ...}`
- `transcript_final(text)` → `{"type": "transcript.final", ...}`
- `response_end()` → `{"type": "response.end"}`
- `error_msg(code, message, fatal)` → `{"type": "error", ...}`

#### `backend/ws/handler.py`

```
WebSocket connect
  └─ recv loop:
       ├─ binary frame  → buffer audio (Phase 3 wires this)
       └─ text frame    → parse ClientMessage
            ├─ session.start  → session_store.create(), open realtime client (Phase 3), send session.ready
            ├─ audio.stop     → signal realtime client (Phase 3)
            └─ session.end    → close realtime client, session_store.delete(), close WS 1000
```

Error handling:
- Unknown `type` → send `INVALID_MESSAGE_TYPE` (non-fatal)
- Schema validation fail → send `INVALID_MESSAGE_SCHEMA` (non-fatal)
- `audio.*` before `session.start` → send `SESSION_NOT_FOUND` (non-fatal)
- Unhandled exception → send `INTERNAL_ERROR` (fatal), close WS 1011

**Tests:** `test_ws_handler.py` — connection lifecycle, message routing, error paths.

**Effort:** ~3 hours

---

## Phase 3 — OpenAI Realtime Client

**Objective:** Proxy audio + control messages between client WS and OpenAI Realtime API.

**Depends on:** Phase 2

### Deliverables

#### `backend/pipeline/realtime-client.py`

```
class RealtimeClient:
    async def connect(session_id, voice, history)
        # open wss://api.openai.com/v1/realtime
        # send session.update: model, voice, tools config, conversation history
        # start recv loop (asyncio task)

    async def send_audio(pcm_bytes)
        # send input_audio_buffer.append event to OpenAI

    async def flush()
        # send input_audio_buffer.commit + response.create
        # called when audio.stop received

    async def close()
        # cancel recv task, close OpenAI WS

    # Internal recv loop handles OpenAI events:
    # response.audio.delta         → callback: forward binary to client WS
    # response.audio_transcript.delta → callback: send transcript.partial
    # response.done                → callback: send response.end
    # response.function_call       → execute tool, send function_call_output
    # error                        → callback: send error to client
```

Tool stubs (Phase 3 scope — wire to real logic in Phase 7):
- `lookup_order_status(order_id) → str`
- `check_availability(date) → str`
- `transfer_to_human() → str`

**Error mapping:**
- OpenAI WS connection fail → `OPENAI_CONNECTION_FAILED` (fatal)
- OpenAI error event → `OPENAI_API_ERROR` (non-fatal)
- OpenAI 429 → `OPENAI_RATE_LIMITED` (fatal)

**Logging:** all key actions per `docs/architecture.md` §10 log table.

**Tests:** Mock OpenAI WS responses. Test audio forwarding, transcript events, `response.done` flow.

**Effort:** ~4 hours

---

## Phase 4 — Frontend Foundation

**Objective:** Vite app connects to backend WS, manages session state, renders connection status.

**Depends on:** Phase 2 (backend WS endpoint live)

### Deliverables

#### `frontend/src/stores/session-store.ts`

```typescript
interface SessionState {
  sessionId: string | null
  state: 'idle' | 'connected' | 'listening' | 'processing' | 'speaking'
  transcript: { role: 'user' | 'assistant'; text: string }[]
  isConnected: boolean
  error: string | null

  connect: () => void
  disconnect: () => void
  addMessage: (role: 'user' | 'assistant', text: string) => void
  setState: (state: SessionState['state']) => void
  setError: (error: string | null) => void
}
```

#### `frontend/src/lib/ws-client.ts`

```typescript
class WsClient {
  connect(url, handlers): void
    // open WS, send session.start
    // register onMessage, onClose, onError

  sendAudioChunk(pcm: ArrayBuffer): void
    // send binary frame

  sendAudioStop(): void
    // send { type: "audio.stop" }

  disconnect(): void
    // send { type: "session.end" }, close WS
}

// handlers interface:
interface WsHandlers {
  onSessionReady(sessionId: string): void
  onTranscriptPartial(text: string): void
  onTranscriptFinal(text: string): void
  onResponseAudio(chunk: ArrayBuffer): void
  onResponseEnd(): void
  onError(code: string, message: string, fatal: boolean): void
}
```

- Message parsing via Zod schemas (mirror `docs/api-contract.md` §4 server messages)
- Reconnection with exponential backoff on fatal errors / WS close 1001/1011

#### `frontend/src/App.tsx`

- Wire `WsClient` → `SessionStore`
- Render: connection button, `state` badge, error banner

**Tests:** `ws-client.test.ts` — mock WS server, verify message round-trips, state transitions.

**Effort:** ~3 hours

---

## Phase 5 — Audio Pipeline

**Objective:** Mic capture → PCM chunks → WS; WS binary → PCM → AudioWorklet playback.

**Depends on:** Phase 4

### Deliverables

#### `frontend/src/lib/audio-capture.ts`

```
getUserMedia({ audio: true })
  └─ AudioContext (16 kHz)
       └─ AudioWorkletNode (capture-processor)
            └─ port.onmessage: Float32 PCM
                 └─ convert to Int16 LE
                      └─ ws.sendAudioChunk(buffer)
```

- Chunk size: 4096 samples (~256 ms)
- Only sends while `vadActive = true` (wired in next step)

#### `frontend/src/lib/audio-playback.ts`

```
ws.onResponseAudio(chunk)
  └─ push Int16 PCM to ring buffer
       └─ AudioWorkletNode (playback-processor) pulls from buffer
            └─ gapless playback via AudioContext
```

- `response.end` → drain buffer, mark silent

#### `frontend/src/lib/vad.ts`

```typescript
class VadController {
  async start(onSpeechStart, onSpeechEnd): Promise<void>
    // init @ricky0123/vad-web MicVAD
    // onSpeechStart → enable audio-capture sending
    // onSpeechEnd   → ws.sendAudioStop(), disable sending

  stop(): void
}
```

- Integrate with `audio-capture.ts`: VAD controls when chunks are sent
- On `onSpeechStart` → SessionStore.setState('listening')
- On `onSpeechEnd` → SessionStore.setState('processing')

**Tests:** Unit test PCM conversion (Float32→Int16), ring buffer overflow/underflow.

**Effort:** ~4 hours

---

## Phase 6 — UI Components

**Objective:** Polished voice assistant UI. Three components + Tailwind styling.

**Depends on:** Phase 4 (store + state machine live)

### Deliverables

#### `voice-controls.tsx`

- Mic button: `IDLE` → click → `connect()` → `CONNECTED`
- Mic active indicator: `LISTENING` state
- Stop button: `disconnect()`
- Error display: `error` from store

#### `transcript-panel.tsx`

- Scrollable message list from `transcript[]`
- Live partial transcript overlay during `LISTENING`/`PROCESSING`
- User messages (right-aligned) / assistant messages (left-aligned)

#### `audio-visualizer.tsx`

- Waveform or volume bar using `AnalyserNode` from AudioContext
- Active during `LISTENING` and `SPEAKING` states
- Flat line in `IDLE`/`CONNECTED`/`PROCESSING`

**State → UI mapping:**

| State        | Mic button | Visualizer | Status badge |
|--------------|------------|------------|--------------|
| `idle`       | Start      | Off        | Offline      |
| `connected`  | Active     | Flat       | Ready        |
| `listening`  | Active     | Input wave | Listening    |
| `processing` | Active     | Flat       | Thinking     |
| `speaking`   | Active     | Output wave| Speaking     |

**Effort:** ~3 hours

---

## Phase 7 — Integration & Hardening

**Objective:** Full end-to-end flow verified. Error paths tested. Production-readiness checks.

**Depends on:** Phases 1–6

### Deliverables

#### Backend

- `test_ws_handler.py` — integration tests: full `session.start → audio → audio.stop → response.end` lifecycle with mocked OpenAI
- Session TTL cleanup verified under test
- CORS configured: allow frontend origin

#### Frontend

- `session-store.test.ts` — all state transitions, reconnect logic
- Error boundary in `App.tsx` for fatal WS errors

#### Docker Compose

- Backend: `HEALTHCHECK CMD curl -f http://localhost:8000/health`
- Frontend: proxy `/ws` to backend in `vite.config.ts`

```typescript
// vite.config.ts
server: {
  proxy: {
    '/ws': { target: 'ws://backend:8000', ws: true }
  }
}
```

#### Smoke test checklist (manual)

- [ ] `docker compose up` → both services start clean
- [ ] Browser → `http://localhost:3000` → `IDLE` state
- [ ] Click Start → `session.start` sent → `session.ready` received → `CONNECTED`
- [ ] Speak → VAD fires → audio streams → transcript appears
- [ ] Silence detected → `audio.stop` → `PROCESSING` → assistant speaks → `SPEAKING` → `CONNECTED`
- [ ] `GET http://localhost:8000/health` → `200 healthy`
- [ ] Click Stop → `session.end` → WS close 1000 → `IDLE`

**Effort:** ~3 hours

---

## Docs Impact

| File                    | Action   | Phase     |
|-------------------------|----------|-----------|
| `docs/architecture.md`  | existing | reference |
| `docs/api-contract.md`  | existing | reference |
| `docs/plan.md`          | create   | pre-build |
| `README.md`             | create   | Phase 0   |

`README.md` (Phase 0) must include: project description, quickstart (`docker compose up`), env setup.

---

## Test Strategy

### Backend (pytest)

| File                       | Scope                          | Phase |
|----------------------------|--------------------------------|-------|
| `test_session.py`          | SessionStore CRUD, TTL cleanup | 1     |
| `test_ws_handler.py`       | Message routing, error codes   | 2     |
| `test_realtime_client.py`  | Audio proxy, event forwarding  | 3     |

- Unit tests mock OpenAI WS (`unittest.mock.AsyncMock`)
- Integration tests use `httpx.AsyncClient` + `websockets` test client
- Coverage target: ≥ 70%

### Frontend (vitest)

| File                         | Scope                          | Phase |
|------------------------------|--------------------------------|-------|
| `ws-client.test.ts`          | WS message round-trips         | 4     |
| `session-store.test.ts`      | State transitions, store actions| 4    |
| `audio-capture.test.ts`      | PCM conversion, chunk sizing   | 5     |

- No AudioWorklet in jsdom — use offscreen AudioContext or mock processor
- All tests run pre-commit

---

## Observability

Per `docs/architecture.md` §10 — implemented in Phase 1 (`logger.py`), used from Phase 2 onward.

**Key events logged (backend):**

| Phase | Action                    | Level |
|-------|---------------------------|-------|
| 1     | `session_created`         | info  |
| 1     | `session_expired`         | info  |
| 2     | `ws_connected`            | info  |
| 2     | `ws_message_invalid`      | warn  |
| 3     | `realtime_session_opened` | info  |
| 3     | `transcript_final`        | info  |
| 3     | `response_ended`          | info  |
| 3     | `pipeline_error`          | error |

**Health check:** Phase 1. `GET /health` returns `openai_realtime: reachable/unreachable`.

**Frontend:** `console.error` for fatal WS errors; structured log object pattern:
```typescript
console.info({ action: 'session_ready', sessionId, ts: Date.now() });
```

---

## Unresolved Questions

| # | Question | Notes |
|---|----------|-------|
| 1 | Tool stubs in Phase 3 — replace with real integrations in Phase 7 or later? | Defer real tool logic until voice pipeline confirmed working |
| 2 | AudioWorklet processors — inline as string blobs or separate `.js` files? | Separate files preferred for readability; check Vite WASM/worker handling |
| 3 | VAD sensitivity tuning — default `@ricky0123/vad-web` params sufficient? | Test with real speech before hardcoding thresholds |
| 4 | Reconnect strategy — exponential backoff cap and max retries? | Suggested: max 5 retries, 2s base, 30s cap |
| 5 | Frontend testing AudioWorklet — mock or skip in CI? | Skip AudioWorklet processor tests in CI; test logic layer only |
