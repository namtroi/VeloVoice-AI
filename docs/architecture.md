# VeloVoice AI — Architecture Document

> Production-grade, low-latency real-time voice assistant.
> End-to-end target: **< 1.2s** from user speech to assistant audio playback.

---

## Table of Contents

1. [System Overview](#1-system-overview)
2. [Backend Architecture](#2-backend-architecture)
3. [Voice Pipeline & Optimistic Execution](#3-voice-pipeline--optimistic-execution)
4. [WebSocket Protocol](#4-websocket-protocol)
5. [Frontend Architecture](#5-frontend-architecture)
6. [Session & State (Redis)](#6-session--state-redis)
7. [AI Orchestration (LangGraph)](#7-ai-orchestration-langgraph)
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
│                        BROWSER (Next.js)                            │
│  ┌──────────────┐  ┌──────────────┐  ┌─────────────────────────┐   │
│  │ AudioWorklet │  │   UI State   │  │    Zustand Store        │   │
│  │  Capture /   │  │   Machine    │  │  (session, transcript,  │   │
│  │  Playback    │  │              │  │   status)               │   │
│  └──────┬───────┘  └──────────────┘  └─────────────────────────┘   │
│         │                                                           │
│         │  WebSocket (binary audio + JSON control)                  │
└─────────┼───────────────────────────────────────────────────────────┘
          │
          ▼
┌─────────────────────────────────────────────────────────────────────┐
│                     BACKEND (FastAPI + Asyncio)                      │
│                                                                     │
│  ┌──────────┐    ┌──────────┐    ┌──────────┐    ┌──────────────┐  │
│  │    WS    │───▶│   STT    │───▶│   LLM    │───▶│  TTS Buffer  │  │
│  │ Handler  │    │  Stage   │    │  Stage   │    │   + Stream   │  │
│  └──────────┘    └──────────┘    └──────────┘    └──────────────┘  │
│       │                                                │            │
│       │           ┌──────────────────────┐             │            │
│       └──────────▶│   Session Manager    │◀────────────┘            │
│                   └──────────┬───────────┘                          │
│                              │                                      │
└──────────────────────────────┼──────────────────────────────────────┘
                               │
                               ▼
                   ┌───────────────────────┐
                   │        Redis          │
                   │  (session + history)  │
                   └───────────────────────┘
```

### Data Flow (8 Steps)

1. **Capture** — Browser AudioWorklet captures mic input as PCM chunks.
2. **Stream** — Audio chunks sent over WebSocket as binary frames.
3. **Transcribe** — Backend STT stage converts audio → text via streaming STT provider.
4. **Orchestrate** — Transcript forwarded to LangGraph agent for intent resolution + tool calls.
5. **Generate** — LLM streams response tokens incrementally.
6. **Synthesize (optimistic)** — TTS begins on partial token buffer *before* full LLM response completes.
7. **Deliver** — TTS audio chunks streamed back over WebSocket as binary frames.
8. **Playback** — Browser AudioWorklet queues and plays audio chunks in order.

---

## 2. Backend Architecture

### Directory Structure

```
backend/
├── main.py                     # FastAPI app entrypoint
├── config.py                   # Settings (pydantic-settings)
├── ws/
│   ├── handler.py              # WebSocket connection lifecycle
│   ├── message-types.py        # Protocol message definitions
│   └── barge-in.py             # Barge-in detection + cancellation
├── pipeline/
│   ├── stt-stage.py            # Speech-to-text async stage
│   ├── llm-stage.py            # LLM orchestration async stage
│   └── tts-stage.py            # Text-to-speech async stage
├── session/
│   ├── manager.py              # Session create/read/expire
│   └── redis-client.py         # Redis connection pool
├── agents/
│   ├── graph.py                # LangGraph agent definition
│   └── tools.py                # Tool implementations
├── observability/
│   ├── logger.py               # Structured JSON logger
│   ├── metrics.py              # Timing + counters
│   └── health.py               # Health check endpoint
└── tests/
    ├── test_ws_handler.py
    ├── test_pipeline.py
    └── test_session.py
```

### WebSocket Handler Design

Each WebSocket connection spawns 3 concurrent asyncio tasks linked via `asyncio.Queue`:

```
                  asyncio.Queue          asyncio.Queue
  ┌─────────┐    (audio_in)    ┌─────┐   (tokens)    ┌─────────┐
  │ STT     │◀────────────────▶│ LLM │──────────────▶│ TTS     │
  │ Stage   │                  │Stage│               │ Stage   │
  └─────────┘                  └─────┘               └─────────┘
       ▲                                                  │
       │  binary frames                    binary frames  │
       │                                                  ▼
  ┌────────────────────────────────────────────────────────────┐
  │                    WebSocket Connection                     │
  └────────────────────────────────────────────────────────────┘
```

- **STT Stage** — Reads binary audio from WS, forwards to STT provider, emits transcript events.
- **LLM Stage** — Receives final/partial transcripts, invokes LangGraph agent, streams tokens.
- **TTS Stage** — Buffers tokens to sentence boundaries, sends to TTS provider, streams audio back to WS.

All stages run concurrently per connection. Cancellation propagates via `asyncio.Event` (e.g., barge-in).

---

## 3. Voice Pipeline & Optimistic Execution

### 4-Stage Pipeline

```
  User Speech         Transcript          Token Stream        Audio Stream
       │                  │                    │                    │
       ▼                  ▼                    ▼                    ▼
  ┌─────────┐      ┌───────────┐      ┌──────────────┐      ┌──────────┐
  │  STT    │─────▶│   LLM     │─────▶│   Buffer     │─────▶│   TTS    │
  │ ~200ms  │      │  ~400ms   │      │   Strategy   │      │  ~300ms  │
  └─────────┘      └───────────┘      └──────────────┘      └──────────┘
```

### Buffer Strategy

The buffer sits between LLM streaming output and TTS input. It accumulates tokens and flushes to TTS at natural boundaries:

- **Sentence boundary** — flush on `.` `!` `?` followed by whitespace.
- **Clause boundary** — flush on `,` `;` `:` if buffer exceeds ~15 tokens (prevents long pauses).
- **Max buffer** — force-flush at 30 tokens regardless of punctuation.
- **End of response** — flush remaining tokens immediately.

This "optimistic" approach starts TTS synthesis on the *first sentence* while the LLM is still generating subsequent sentences, eliminating wait-for-complete-response latency.

### Latency Budget (~900ms target, <1200ms ceiling)

| Stage       | Target  | Notes                                      |
|-------------|---------|---------------------------------------------|
| STT         | ~200ms  | Streaming; partial results available early  |
| LLM (TTFT) | ~400ms  | Time to first token; model-dependent        |
| Buffer fill | ~50ms   | First sentence boundary reached             |
| TTS         | ~250ms  | Streaming; first audio chunk returned       |
| **Total**   | **~900ms** | First audible response from user's end-of-speech |

### Optimistic Execution Flow

```
Time ──────────────────────────────────────────────────────────▶

User speaking ████████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
STT streaming        ░░░████████░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░░
LLM streaming                 ░░░██████████████░░░░░░░░░░░░░░░░
Buffer                             ░░██░░░░░░██░░░░░░██░░░░░░░░
TTS streaming                         ░░████████░░░░░░░████████░
User hears                               ░░██████████████████████

                              ▲                ▲
                     first token        first audio chunk
                     from LLM          reaches browser
```

---

## 4. WebSocket Protocol

All messages are JSON-encoded text frames unless noted. Audio is sent as binary frames.

### Client → Server Messages

| Type               | Payload                          | Description                          |
|--------------------|----------------------------------|--------------------------------------|
| `session.start`    | `{ config }`                     | Initialize session, set preferences  |
| `audio.chunk`      | _(binary frame)_                 | Raw PCM audio from mic               |
| `audio.stop`       | `{}`                             | User stopped speaking (VAD signal)   |
| `barge_in`         | `{}`                             | User interrupted — cancel response   |
| `session.end`      | `{}`                             | Graceful disconnect                  |

### Server → Client Messages

| Type                  | Payload                                  | Description                              |
|-----------------------|------------------------------------------|------------------------------------------|
| `session.ready`       | `{ session_id }`                         | Session created, ready for audio         |
| `transcript.partial`  | `{ text, is_final: false }`              | Interim STT result                       |
| `transcript.final`    | `{ text, is_final: true }`               | Final STT result                         |
| `response.audio`      | _(binary frame)_                         | TTS audio chunk for playback             |
| `response.text`       | `{ text, is_final: bool }`               | Assistant text (for display)             |
| `response.end`        | `{}`                                     | Full response delivered                  |
| `error`               | `{ code, message }`                      | Error with machine-readable code         |

### Barge-in Flow

```
Client                          Server
  │                               │
  │──── audio.chunk ─────────────▶│  (user speaking over assistant)
  │                               │
  │──── barge_in ────────────────▶│  (client detects overlap)
  │                               │
  │                               │── cancel TTS task
  │                               │── cancel LLM task
  │                               │── flush audio queue
  │                               │
  │◀─── response.end ────────────│  (signals cancellation complete)
  │                               │
  │──── audio.chunk ─────────────▶│  (new user utterance proceeds)
```

On barge-in:
1. Client sends `barge_in` message and stops audio playback.
2. Server cancels in-flight TTS + LLM tasks via shared `asyncio.Event`.
3. Server sends `response.end` to confirm cancellation.
4. Pipeline resets — ready for next utterance.

---

## 5. Frontend Architecture

### Directory Structure

```
frontend/
├── app/
│   ├── layout.tsx
│   └── page.tsx                  # Main voice assistant page
├── components/
│   ├── voice-controls.tsx        # Mic toggle, status indicators
│   ├── transcript-panel.tsx      # Live transcription display
│   └── audio-visualizer.tsx      # Waveform / volume meter
├── lib/
│   ├── ws-client.ts              # WebSocket connection manager
│   ├── audio-capture.ts          # AudioWorklet mic capture
│   ├── audio-playback.ts         # AudioWorklet playback queue
│   └── barge-in-detector.ts      # Client-side barge-in logic
├── stores/
│   └── session-store.ts          # Zustand store
├── workers/
│   ├── capture-processor.js      # AudioWorklet processor (capture)
│   └── playback-processor.js     # AudioWorklet processor (playback)
└── tests/
    ├── ws-client.test.ts
    └── session-store.test.ts
```

### AudioWorklet Capture / Playback

**Capture pipeline:**
1. `getUserMedia()` → `AudioContext` → `AudioWorkletNode` (capture-processor).
2. Processor emits PCM Float32 chunks via `port.postMessage`.
3. `audio-capture.ts` receives chunks, converts to required format, sends over WS.

**Playback pipeline:**
1. Server audio chunks arrive via WS as binary frames.
2. `audio-playback.ts` decodes and queues chunks in a ring buffer.
3. `AudioWorkletNode` (playback-processor) pulls from buffer for gapless playback.
4. On barge-in: buffer is flushed, playback stops immediately.

### UI State Machine

```
  ┌──────────┐   session.start   ┌────────────┐   audio.chunk    ┌───────────┐
  │          │──────────────────▶│            │────────────────▶│           │
  │   IDLE   │                   │ CONNECTED  │                  │ LISTENING │
  │          │◀──────────────────│            │◀────────────────│           │
  └──────────┘   session.end     └────────────┘   audio.stop     └─────┬─────┘
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
  addMessage():  void
  setState():   void
  setError():   void
}
```

---

## 6. Session & State (Redis)

### Key Schema

| Key Pattern                         | Type   | TTL     | Description                    |
|-------------------------------------|--------|---------|--------------------------------|
| `session:{session_id}`              | Hash   | 30 min  | Session metadata + config      |
| `session:{session_id}:history`      | List   | 30 min  | Conversation turns (JSON)      |
| `session:{session_id}:state`        | String | 30 min  | Current pipeline state         |

### Session Lifecycle

```
  CREATE              ACTIVE              IDLE                EXPIRE
    │                   │                   │                    │
    ▼                   ▼                   ▼                    ▼
┌────────┐  audio   ┌────────┐  no audio  ┌────────┐  TTL hit  ┌─────────┐
│  New   │─────────▶│ Active │──────────▶│  Idle  │─────────▶│ Expired │
│session │          │        │  (>5 min)  │        │  (30min) │         │
└────────┘          └────────┘           └────────┘          └─────────┘
                         ▲                   │
                         │    audio resumes  │
                         └───────────────────┘
```

- **Create** — On `session.start`, generate UUID, store config in Redis hash.
- **Active** — While audio flows, TTL resets on each interaction.
- **Idle** — No activity for 5 min. Session persists but resources freed.
- **Expire** — Redis TTL (30 min) expires. Session data deleted.

### Conversation Memory

Each turn stored in `session:{id}:history` as JSON:

```json
{
  "role": "user | assistant",
  "content": "text content",
  "timestamp": "ISO-8601",
  "metadata": { "duration_ms": 1200, "tool_calls": [] }
}
```

LangGraph agent receives last N turns as context window (configurable, default: 20 turns).

---

## 7. AI Orchestration (LangGraph)

### Agent Graph

```
                    ┌──────────────┐
                    │   START      │
                    │  (transcript)│
                    └──────┬───────┘
                           │
                           ▼
                    ┌──────────────┐
              ┌────▶│   ROUTER     │◀───────────────┐
              │     │  (classify)  │                │
              │     └──────┬───────┘                │
              │            │                        │
              │     ┌──────┼──────┐                 │
              │     ▼      ▼      ▼                 │
              │  ┌─────┐┌─────┐┌──────┐             │
              │  │CHAT ││TOOL ││GUARD │             │
              │  │     ││CALL ││(safe?)│             │
              │  └──┬──┘└──┬──┘└──┬───┘             │
              │     │      │      │                 │
              │     │      ▼      │                 │
              │     │  ┌──────┐   │                 │
              │     │  │EXEC  │   │                 │
              │     │  │TOOL  │───┘                 │
              │     │  └──┬───┘                     │
              │     │     │ (tool result)           │
              │     │     └─────────────────────────┘
              │     ▼
              │  ┌──────────────┐
              │  │   STREAM     │
              │  │  (response)  │
              │  └──────┬───────┘
              │         │
              │         ▼
              │  ┌──────────────┐
              └──│     END      │
                 └──────────────┘
```

**Nodes:**
- **Router** — Classifies intent: direct chat, tool-needed, or safety-guard.
- **Chat** — Direct conversational response, no tools needed.
- **Tool Call** — LLM decides which tool(s) to invoke.
- **Exec Tool** — Executes tool, returns result to Router for follow-up.
- **Guard** — Safety check — rejects out-of-scope or harmful requests.
- **Stream** — Streams final response tokens to TTS stage.

### Tool-Calling Pattern

```python
# Tools registered with LangGraph agent
tools = [
    lookup_order_status,    # Query order by ID
    check_availability,     # Product/schedule lookup
    transfer_to_human,      # Escalation
    # ... domain-specific tools
]
```

Tool execution is async. Results feed back into the Router node for potential multi-step reasoning (e.g., lookup → follow-up question → action).

### Streaming Integration

LangGraph agent uses `astream_events()` to yield tokens as they're generated. The LLM stage forwards these tokens to the TTS buffer queue, enabling optimistic execution.

---

## 8. Infrastructure

### Docker Compose (Development)

```
┌────────────────────────────────────────────────────────┐
│                   docker-compose.yml                    │
│                                                        │
│  ┌──────────────┐  ┌──────────┐  ┌──────────────────┐ │
│  │   backend    │  │  redis   │  │    frontend       │ │
│  │  Python 3.11 │  │  7.x     │  │   Next.js 14+    │ │
│  │  Port: 8000  │  │  Port:   │  │   Port: 3000     │ │
│  │              │──▶│  6379    │  │                  │ │
│  │  FastAPI +   │  │          │  │   Dev server     │ │
│  │  Uvicorn     │  │          │  │                  │ │
│  └──────────────┘  └──────────┘  └──────────────────┘ │
│                                                        │
│  Network: velovoice-net (bridge)                       │
└────────────────────────────────────────────────────────┘
```

**Services:**

| Service    | Image / Base      | Ports          | Depends On |
|------------|-------------------|----------------|------------|
| `backend`  | Python 3.11-slim  | 8000:8000      | redis      |
| `redis`    | redis:7-alpine    | 6379 (internal)| —          |
| `frontend` | node:20-alpine    | 3000:3000      | backend    |

### Production Notes

- **Backend scaling** — Uvicorn workers behind reverse proxy (nginx/Caddy). Each worker handles many WS connections via asyncio.
- **Redis** — Consider Redis Sentinel or managed Redis for HA.
- **TLS** — Terminate at reverse proxy. WSS required in production.
- **Secrets** — Env vars via `.env` file (dev) or secret manager (prod). Never committed.
- **Health checks** — Docker health check hits `/health` endpoint.

---

## 9. Design Decisions

| Decision                            | Choice                         | Rationale                                                        | Tradeoff                                            |
|-------------------------------------|--------------------------------|------------------------------------------------------------------|-----------------------------------------------------|
| Backend framework                   | FastAPI + asyncio              | Native async, WebSocket support, high concurrency                | Smaller ecosystem than Django                       |
| Real-time protocol                  | WebSockets                    | Full-duplex, low overhead for streaming audio                    | No built-in reconnection (must implement)           |
| Voice pipeline                      | OpenAI Realtime API (primary) | Single API for STT+LLM+TTS, lowest latency                      | Vendor lock-in, cost                                |
| Voice pipeline (fallback)           | Deepgram STT + ElevenLabs TTS | Best-in-class individual providers                               | Higher integration complexity, slightly more latency|
| Optimistic execution                | Buffer + stream TTS early     | ~300ms latency saved vs wait-for-complete                        | Potential for mid-sentence TTS if LLM changes course|
| State management                    | Redis                         | Fast, TTL support, pub/sub for future scaling                    | Extra infra component                               |
| AI orchestration                    | LangGraph                     | Stateful agent graphs, tool-calling, streaming                   | Learning curve, abstraction overhead                |
| Frontend framework                  | Next.js                       | React ecosystem, SSR for initial load, API routes                | Heavier than plain React for SPA                    |
| Audio handling                      | AudioWorklet API              | Low-latency, off-main-thread processing                          | Limited browser support (no Safari < 14.5)          |
| Client state                        | Zustand                       | Minimal boilerplate, good for real-time state                    | Less structure than Redux                           |

### Why OpenAI Realtime API?

The Realtime API provides a unified WebSocket interface for speech-to-speech, eliminating the need to chain separate STT → LLM → TTS services. Benefits:

- **Latency** — Single round-trip vs. three sequential API calls.
- **Context** — Audio and text context maintained in one session.
- **Simplicity** — One integration point instead of three.

The modular pipeline design allows swapping to Deepgram + ElevenLabs without architectural changes.

---

## 10. Observability

### Structured Logging

All logs emitted as JSON with consistent fields:

```json
{
  "timestamp": "ISO-8601",
  "level": "info",
  "action": "stt_transcript_received",
  "session_id": "uuid",
  "duration_ms": 210,
  "metadata": {}
}
```

**Log levels:**
- `debug` — Development tracing (audio chunk sizes, buffer state).
- `info` — Operational events (session created, transcript received, response sent).
- `warn` — Recoverable issues (STT timeout, retry triggered).
- `error` — Failures (provider API error, WS disconnect, unhandled exception).

### Key Metrics

| Metric                         | Type      | Description                              |
|--------------------------------|-----------|------------------------------------------|
| `stt_latency_ms`              | Histogram | Time from audio received to transcript   |
| `llm_ttft_ms`                 | Histogram | LLM time-to-first-token                  |
| `tts_latency_ms`              | Histogram | Time from text to first audio chunk      |
| `e2e_latency_ms`              | Histogram | End-to-end: user speech → assistant audio|
| `active_sessions`             | Gauge     | Current WebSocket connections             |
| `barge_in_count`              | Counter   | Barge-in events                          |
| `pipeline_errors`             | Counter   | Pipeline stage failures (by stage)       |

### Health Checks

**Endpoint:** `GET /health`

```json
{
  "status": "healthy",
  "checks": {
    "redis": "connected",
    "stt_provider": "reachable",
    "llm_provider": "reachable",
    "tts_provider": "reachable"
  },
  "uptime_seconds": 3600
}
```

Returns `200` if all checks pass, `503` if any critical check fails. Used by Docker health checks and load balancers.

---

## 11. Test Strategy

| Layer              | Scope                                    | Tools                    | Coverage Target |
|--------------------|------------------------------------------|--------------------------|-----------------|
| **Unit**           | Individual functions, buffer logic, store | pytest / vitest          | ≥ 80%          |
| **Integration**    | Pipeline stages, Redis session ops, WS   | pytest + httpx/websockets| ≥ 70%          |
| **E2E**            | Full voice flow (recorded audio in/out)  | Playwright + custom      | Critical paths  |
| **Contract**       | WS message schema validation             | pydantic / zod           | 100% of types  |
| **Load**           | Concurrent WS connections, latency P99   | Locust / k6              | Benchmarks      |

**Principles:**
- Tests written *before* implementation (TDD — Red → Green → Refactor).
- No mocks for core pipeline logic — use real providers in integration tests (with recorded fixtures for CI).
- Contract tests ensure client/server message compatibility.
- Load tests validate latency budget under concurrent sessions.

---

## 12. Unresolved Questions

| #  | Question                                                                 | Impact     | Notes                                                        |
|----|--------------------------------------------------------------------------|------------|--------------------------------------------------------------|
| 1  | OpenAI Realtime API vs. Deepgram+ElevenLabs as default provider?         | High       | Affects latency, cost, and pipeline complexity               |
| 2  | VAD (Voice Activity Detection) — server-side or client-side?             | Medium     | Client-side saves bandwidth; server-side more accurate       |
| 3  | Audio format — PCM 16-bit vs. Opus codec for WS transport?              | Medium     | Opus reduces bandwidth ~10x but adds encode/decode latency   |
| 4  | Max concurrent sessions per backend instance?                            | High       | Determines scaling strategy and resource allocation          |
| 5  | Conversation history — full context vs. sliding window vs. summary?      | Medium     | Affects LLM cost and response quality for long conversations |
| 6  | Authentication — JWT tokens or session cookies for WS upgrade?           | Medium     | Security model not yet defined                               |
| 7  | Multi-language support — required for V1 or deferred?                    | Low        | Affects STT/TTS provider selection and prompt design         |
