# VeloVoice AI — Architecture Document

> Production-grade, low-latency real-time voice assistant.
> End-to-end target: **< 1.2s** from user speech to assistant audio playback.

---

## Tech Stack

| Layer              | Technology                        | Purpose                                      |
|--------------------|-----------------------------------|----------------------------------------------|
| **Backend**        | Python 3.11+, FastAPI, Uvicorn    | Async HTTP + WebSocket server                |
| **Voice AI**       | OpenAI Realtime API               | STT + LLM + TTS in one WebSocket session     |
| **Real-time comm** | WebSockets                        | Full-duplex audio + control message channel  |
| **Session state**  | Python in-memory dict             | Single-process session storage, no DB needed |
| **Frontend**       | Vite + React 18, TypeScript, Tailwind CSS | SPA framework, fast HMR dev server    |
| **Audio (browser)**| Web Audio API + AudioWorklet      | Low-latency mic capture and playback         |
| **VAD**            | @ricky0123/vad-web                | Client-side voice activity detection         |
| **Client state**   | Zustand                           | Lightweight React state management           |
| **Config**         | pydantic-settings                 | Typed settings from env vars                 |
| **Validation**     | Pydantic (backend), Zod (frontend)| WS message schema validation                 |
| **Infra**          | Docker, Docker Compose            | Containerised dev environment (2 services)   |
| **Testing**        | pytest, httpx, vitest             | Unit + integration tests                     |
| **Logging**        | Python `logging` + JSON formatter | Structured observability                     |

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Backend Architecture](#2-backend-architecture)
3. [Voice Pipeline](#3-voice-pipeline)
4. [WebSocket Protocol](#4-websocket-protocol)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Session & State (In-Memory)](#6-session--state-in-memory)
7. [AI Orchestration (OpenAI Realtime API)](#7-ai-orchestration-openai-realtime-api)
8. [Infrastructure](#8-infrastructure)
9. [Design Decisions](#9-design-decisions)
10. [Observability](#10-observability)
11. [Test Strategy](#11-test-strategy)
12. [Unresolved Questions](#12-unresolved-questions)

---

## 1. System Overview

### Component Diagram

```
┌─────────────────────────────────────────────────────────────────────┐
│                   BROWSER (Vite + React + Tailwind)                 │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐   │
│  │ AudioWorklet │  │   UI State   │  │    Zustand Store        │   │
│  │  Capture /   │  │   Machine    │  │  (session, transcript,  │   │
│  │  Playback    │  │              │  │   status)               │   │
│  └──────┬───────┘  └──────────────┘  └─────────────────────────┘   │
│  ┌──────┴───────┐                                                   │
│  │  VAD         │  (client-side voice activity detection)           │
│  │  (@ricky0123)│                                                   │
│  └──────┬───────┘                                                   │
│         │  WebSocket (binary audio + JSON control)                  │
└─────────┼───────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     BACKEND (FastAPI + Asyncio)                      │
│                                                                     │
│  ┌──────────┐              ┌──────────────────────────────────────┐ │
│  │    WS    │─────────────▶│         realtime-client.py          │ │
│  │ Handler  │◀─────────────│   (proxy audio ↔ OpenAI session)   │ │
│  └──────────┘              └──────────────────┬───────────────────┘ │
│       │                                       │                     │
│       │           ┌──────────────────────┐    │                     │
│       └──────────▶│   Session Store      │    │                     │
│                   │  (in-memory dict)    │    │                     │
│                   └──────────────────────┘    │                     │
└───────────────────────────────────────────────┼─────────────────────┘
                                                │
                                                ▼
                              ┌─────────────────────────────┐
                              │   OpenAI Realtime API       │
                              │  (STT + LLM + TTS, one WS)  │
                              └─────────────────────────────┘
```

### Data Flow (6 Steps)

1. **Capture** — Browser AudioWorklet captures mic input as PCM chunks; VAD detects speech start/end.
2. **Stream** — Audio chunks sent over WebSocket as binary frames; `audio.stop` sent on silence.
3. **Proxy** — Backend `realtime-client.py` forwards audio to OpenAI Realtime API over a server-side WebSocket.
4. **Generate** — OpenAI Realtime API transcribes, generates response, and synthesizes speech — all in one session.
5. **Deliver** — Realtime API streams audio back to backend; backend forwards to client as binary frames.
6. **Playback** — Browser AudioWorklet queues and plays audio chunks in order.

---

## 2. Backend Architecture

### Directory Structure

```
backend/
├── main.py                     # FastAPI app entrypoint
├── config.py                   # Settings (pydantic-settings)
├── ws/
│   ├── handler.py              # WebSocket connection lifecycle
│   └── message-types.py        # Protocol message definitions (Pydantic)
├── pipeline/
│   └── realtime-client.py      # OpenAI Realtime API proxy (async)
├── session/
│   └── store.py                # In-memory session dict + asyncio TTL
├── observability/
│   ├── logger.py               # Structured JSON logger
│   └── health.py               # GET /health endpoint
└── tests/
    ├── test_ws_handler.py
    └── test_session.py
```

### WebSocket Handler Design

Each WebSocket connection spawns two linked asyncio tasks:

```
  ┌──────────────────────────────────────────────────────────────┐
  │                    WebSocket Connection                       │
  └───────────────┬──────────────────────────────────────────────┘
                  │
        ┌─────────▼──────────┐
        │    ws/handler.py   │
        │  - auth/session    │
        │  - route messages  │
        └─────────┬──────────┘
                  │
        ┌─────────▼──────────────────┐
        │  pipeline/realtime-        │
        │  client.py                 │
        │  - open OpenAI session     │
        │  - pipe audio in/out       │
        │  - handle tool calls       │
        └────────────────────────────┘
```

- **handler.py** — Manages connection lifecycle, reads client messages, routes to realtime client.
- **realtime-client.py** — Maintains a server-side WebSocket to OpenAI Realtime API. Streams audio in both directions. Handles `response.function_call` events for tool execution.

All I/O is async. Each connection is isolated — no shared mutable state between connections.

---

## 3. Voice Pipeline

### Overview

```
  User Speech              OpenAI Realtime API              Assistant Audio
       │                           │                               │
       ▼                           ▼                               ▼
  ┌─────────┐     proxy      ┌───────────┐     proxy        ┌──────────┐
  │  Client │───────────────▶│  Realtime │────────────────▶│  Client  │
  │  Audio  │  (PCM binary)  │   API     │  (PCM binary)   │  Audio   │
  └─────────┘                └───────────┘                  └──────────┘
      ~200ms (VAD)             ~400ms (TTFT)                   ~300ms (TTS)
```

### Latency Budget (~900ms target, <1200ms ceiling)

| Stage             | Target     | Notes                                           |
|-------------------|------------|-------------------------------------------------|
| VAD (client)      | ~200ms     | Detects end of speech, fires `audio.stop`       |
| Realtime API TTFT | ~400ms     | Time to first audio token from OpenAI           |
| Audio delivery    | ~300ms     | Streaming; first chunk reaches browser          |
| **Total**         | **~900ms** | First audible response from user's end-of-speech|

### Optimistic Audio Streaming

The OpenAI Realtime API streams synthesized speech incrementally as it generates the response — it does not wait for the full response to complete before sending audio. This is equivalent to optimistic TTS execution, handled server-side by the API with no custom buffer logic required in the backend.

```
Time ──────────────────────────────────────────────────────────▶

User speaking ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
VAD fires            ░░░░░████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
Realtime API                 ░░░░██████████████░░░░░░░░░░░░░░░░░
Audio streamed back               ░░░░░████████████████████████░
User hears                              ░░░██████████████████████

                                   ▲              ▲
                              first audio      response
                              chunk sent       complete
```

---

## 4. WebSocket Protocol

All control messages are JSON text frames. Audio is binary frames.

### Client → Server Messages (4 types)

| Type            | Payload          | Description                          |
|-----------------|------------------|--------------------------------------|
| `session.start` | `{ config }`     | Initialize session, set preferences  |
| `audio.chunk`   | _(binary frame)_ | Raw PCM audio from mic               |
| `audio.stop`    | `{}`             | VAD detected end of speech           |
| `session.end`   | `{}`             | Graceful disconnect                  |

### Server → Client Messages (5 types)

| Type                 | Payload                     | Description                      |
|----------------------|-----------------------------|----------------------------------|
| `session.ready`      | `{ session_id }`            | Session created, ready for audio |
| `transcript.partial` | `{ text, is_final: false }` | Interim STT result               |
| `transcript.final`   | `{ text, is_final: true }`  | Final STT result                 |
| `response.audio`     | _(binary frame)_            | TTS audio chunk for playback     |
| `response.end`       | `{}`                        | Full response delivered          |
| `error`              | `{ code, message }`         | Error with machine-readable code |

> **Barge-in** (user interrupting mid-response) is deferred to Phase 2.

---

## 5. Frontend Architecture

### Directory Structure

```
frontend/
├── index.html                    # Vite entry point
├── vite.config.ts
├── src/
│   ├── main.tsx                  # React root mount
│   ├── App.tsx                   # Top-level component + routing
│   ├── components/
│   │   ├── voice-controls.tsx    # Mic toggle, status indicators
│   │   ├── transcript-panel.tsx  # Live transcription display
│   │   └── audio-visualizer.tsx  # Waveform / volume meter
│   ├── lib/
│   │   ├── ws-client.ts          # WebSocket connection manager
│   │   ├── audio-capture.ts      # AudioWorklet mic capture
│   │   ├── audio-playback.ts     # AudioWorklet playback queue
│   │   └── vad.ts                # VAD wrapper (@ricky0123/vad-web)
│   ├── stores/
│   │   └── session-store.ts      # Zustand store
│   └── tests/
│       ├── ws-client.test.ts
│       └── session-store.test.ts
```

### AudioWorklet Capture / Playback

**Capture pipeline:**
1. `getUserMedia()` → `AudioContext` → `AudioWorkletNode`.
2. Processor emits PCM Float32 chunks via `port.postMessage`.
3. `audio-capture.ts` receives chunks, sends over WS as binary frames.

**Playback pipeline:**
1. Server audio chunks arrive via WS as binary frames.
2. `audio-playback.ts` decodes and queues chunks in a ring buffer.
3. `AudioWorkletNode` pulls from buffer for gapless playback.

### VAD (Voice Activity Detection)

Client-side VAD via `@ricky0123/vad-web`. Runs in-browser, no server round-trip.

- On **speech start** — begin sending `audio.chunk` frames.
- On **speech end** (silence detected) — send `audio.stop`, stop sending audio.

Eliminates need for server-side VAD logic. Reduces bandwidth (no audio sent during silence).

### UI State Machine

```
  ┌──────────┐   session.start   ┌────────────┐  speech start   ┌───────────┐
  │          │──────────────────▶│            │────────────────▶│           │
  │   IDLE   │                   │ CONNECTED  │                  │ LISTENING │
  │          │◀──────────────────│            │◀────────────────│           │
  └──────────┘   session.end     └────────────┘   audio.stop    └─────┬─────┘
                                       │                               │
                                       │                      transcript.final
                                       │                               │
                                       │                         ┌─────▼──────┐
                                       │                         │            │
                                       │                         │ PROCESSING │
                                       │                         │            │
                                       │                         └─────┬──────┘
                                       │                               │
                                       │                       response.audio
                                       │                               │
                                       │                         ┌─────▼──────┐
                                       │         response.end    │            │
                                       │◀────────────────────────│  SPEAKING  │
                                       │                         │            │
                                                                 └────────────┘
```

States: `IDLE` → `CONNECTED` → `LISTENING` → `PROCESSING` → `SPEAKING` → `CONNECTED` (cycle).

### Zustand Store

```
SessionStore {
  sessionId:    string | null
  state:        'idle' | 'connected' | 'listening' | 'processing' | 'speaking'
  transcript:   { role: 'user' | 'assistant', text: string }[]
  isConnected:  boolean
  error:        string | null

  // Actions
  connect():    void
  disconnect(): void
  addMessage(): void
  setState():   void
  setError():   void
}
```

---

## 6. Session & State (In-Memory)

### Data Structure

Sessions stored in a module-level Python dict in `session/store.py`:

```python
sessions: dict[str, SessionData]

SessionData {
  session_id:   str
  history:      list[dict]   # conversation turns
  created_at:   float        # unix timestamp
  last_active:  float        # updated on each interaction
}
```

No external database. Single-process — all sessions share the same dict.

### Session Lifecycle

```
  CREATE              ACTIVE              EXPIRE
    │                   │                    │
    ▼                   ▼                    ▼
┌────────┐  audio   ┌────────┐  TTL hit  ┌─────────┐
│  New   │─────────▶│ Active │──────────▶│ Deleted │
│session │          │        │  (30 min) │ from    │
└────────┘          └────────┘  asyncio  │ dict    │
                         ▲      cleanup  └─────────┘
                         │
                    last_active
                    updated on
                    each turn
```

- **Create** — On `session.start`, generate UUID, add to dict.
- **Active** — `last_active` updated on each interaction.
- **Expire** — Background asyncio task scans dict every 60s, deletes sessions idle > 30 min.

### Conversation History

Each turn stored in `SessionData.history` as a dict:

```json
{
  "role": "user | assistant",
  "content": "text content",
  "timestamp": "ISO-8601"
}
```

Sent to OpenAI Realtime API session on connect. Last 20 turns used as context (configurable).

---

## 7. AI Orchestration (OpenAI Realtime API)

### Overview

The OpenAI Realtime API manages the full STT → LLM → TTS loop within a single persistent WebSocket session. No separate orchestration framework needed.

```
  backend/pipeline/realtime-client.py
  │
  ├── open WebSocket → wss://api.openai.com/v1/realtime
  │
  ├── send session.update (model, voice, tools config)
  │
  ├── pipe audio in:  input_audio_buffer.append  ──▶ OpenAI
  │
  ├── receive events:
  │   ├── response.audio.delta            ──▶ forward binary to client WS
  │   ├── response.audio_transcript.delta ──▶ send transcript.partial to client
  │   ├── response.done                   ──▶ send response.end to client
  │   └── response.function_call          ──▶ execute tool, send result back
  │
  └── pipe audio out: response.audio.delta ──▶ client binary frames
```

### Tool-Calling Pattern

Tools registered via `session.update` at session start:

```python
tools = [
    { "type": "function", "name": "lookup_order_status", ... },
    { "type": "function", "name": "check_availability",  ... },
    { "type": "function", "name": "transfer_to_human",   ... },
]
```

On tool call:
1. OpenAI emits `response.function_call` event with args.
2. `realtime-client.py` executes the corresponding async Python function.
3. Result sent back via `conversation.item.create` (type: `function_call_output`).
4. OpenAI continues generating the response with tool result in context.

### Streaming

Audio streams back incrementally via `response.audio.delta` events — no custom buffering required. Backend forwards each delta directly to the client WebSocket as a binary frame.

---

## 8. Infrastructure

### Docker Compose (Development)

```
┌────────────────────────────────────────────────┐
│               docker-compose.yml               │
│                                                │
│  ┌──────────────┐       ┌──────────────────┐   │
│  │   backend    │       │    frontend      │   │
│  │  Python 3.11 │       │  Vite + React    │   │
│  │  Port: 8000  │       │   Port: 3000     │   │
│  │              │       │                  │   │
│  │  FastAPI +   │       │   Dev server     │   │
│  │  Uvicorn     │       │                  │   │
│  └──────────────┘       └──────────────────┘   │
│                                                │
│  Network: velovoice-net (bridge)               │
└────────────────────────────────────────────────┘
```

**Services:**

| Service    | Image / Base     | Ports     | Depends On |
|------------|------------------|-----------|------------|
| `backend`  | Python 3.11-slim | 8000:8000 | —          |
| `frontend` | node:20-alpine   | 3000:3000 | backend    |

### Production Notes

- **Backend scaling** — Uvicorn workers behind reverse proxy (nginx/Caddy).
- **TLS** — WSS required in production; terminate at reverse proxy. AudioWorklet requires HTTPS (`localhost` exempt for dev).
- **Secrets** — `OPENAI_API_KEY` via `.env` (dev) or secret manager (prod). Never committed.
- **Health checks** — Docker health check hits `/health` endpoint.

---

## 9. Design Decisions

| Decision               | Choice                             | Rationale                                               | Tradeoff                                          |
|------------------------|------------------------------------|---------------------------------------------------------|---------------------------------------------------|
| Backend framework      | FastAPI + asyncio                  | Native async, WebSocket support, high concurrency       | Smaller ecosystem than Django                     |
| Real-time protocol     | WebSockets                         | Full-duplex, low overhead for streaming audio           | No built-in reconnection (must implement)         |
| Voice pipeline         | OpenAI Realtime API                | One API for STT+LLM+TTS; lowest latency; no stitching  | Vendor lock-in; ~$0.06/min cost                   |
| AI orchestration       | OpenAI Realtime API (native)       | Tool calling built-in; no separate framework needed     | Less flexibility than LangGraph for complex flows |
| Session state          | In-memory Python dict              | Zero dependencies; sufficient for single-process dev   | Lost on restart; no multi-process sharing         |
| VAD                    | Client-side (`@ricky0123/vad-web`) | No server code; reduces bandwidth; good accuracy        | No server-side fallback                           |
| Frontend framework     | Vite + React + Tailwind CSS        | SPA-first, fast HMR, no SSR overhead for voice UI       | No SSR (not needed for a voice assistant SPA)     |
| Audio handling         | AudioWorklet API                   | Low-latency, off-main-thread processing                 | Requires HTTPS in prod; no Safari < 14.5          |
| Client state           | Zustand                            | Minimal boilerplate, good for real-time state           | Less structure than Redux                         |

### Why OpenAI Realtime API?

The Realtime API provides a unified WebSocket interface for speech-to-speech, eliminating the need to chain separate STT → LLM → TTS services and a separate orchestration framework. Benefits:

- **Latency** — Single persistent session; no chained API round-trips.
- **Simplicity** — One integration point instead of three providers + LangGraph.
- **Optimistic audio** — Handled server-side; no custom buffer logic.
- **Tool calling** — Built-in via `session.update` tools config.

If provider flexibility is needed later, the modular pipeline design allows swapping `realtime-client.py` for separate STT/LLM/TTS clients without changing the WS handler or frontend.

---

## 10. Observability

### Structured Logging

All logs emitted as JSON with consistent fields:

```json
{
  "timestamp": "ISO-8601",
  "level": "info",
  "action": "session_created",
  "session_id": "uuid",
  "duration_ms": 12,
  "metadata": {}
}
```

**Log levels:**
- `debug` — Dev tracing (audio chunk sizes, API event names).
- `info` — Operational events (session created, transcript received, response sent).
- `warn` — Recoverable issues (API timeout, retry triggered).
- `error` — Failures (API error, WS disconnect, unhandled exception).

**Key actions to log:**

| Action                    | Level | Notes                          |
|---------------------------|-------|--------------------------------|
| `session_created`         | info  | Include session_id             |
| `audio_received`          | debug | Include chunk size bytes       |
| `realtime_session_opened` | info  | OpenAI WS connected            |
| `transcript_final`        | info  | Include text, duration_ms      |
| `response_started`        | info  |                                |
| `response_ended`          | info  | Include total duration_ms      |
| `tool_call_executed`      | info  | Include tool name, duration_ms |
| `session_expired`         | info  | TTL cleanup                    |
| `pipeline_error`          | error | Include error message + stage  |

### Health Check

**Endpoint:** `GET /health`

```json
{
  "status": "healthy",
  "checks": {
    "openai_realtime": "reachable"
  },
  "active_sessions": 2,
  "uptime_seconds": 3600
}
```

Returns `200` if all checks pass, `503` if critical check fails. Used by Docker health checks.

---

## 11. Test Strategy

| Layer           | Scope                                   | Tools                     | Target         |
|-----------------|-----------------------------------------|---------------------------|----------------|
| **Unit**        | Session store, message types, VAD logic | pytest / vitest           | ≥ 70%          |
| **Integration** | WS handler, realtime client proxy       | pytest + httpx/websockets | Critical paths |

**Principles:**
- Tests written before implementation (TDD — Red → Green → Refactor).
- Unit tests mock OpenAI Realtime API responses (valid to mock external provider).
- Integration tests verify the full WS handshake and message flow end-to-end.

---

## 12. Unresolved Questions

| # | Question                                                              | Notes                                              |
|---|-----------------------------------------------------------------------|----------------------------------------------------|
| 1 | OpenAI Realtime API pricing — acceptable for sustained learning use?  | ~$0.06/min audio in + $0.12/min audio out          |
| 2 | HTTPS required for AudioWorklet in production?                        | Yes. `localhost` is exempt for local development.  |
| 3 | VAD library — `@ricky0123/vad-web` vs manual energy threshold?        | Library recommended; handles edge cases well.      |
