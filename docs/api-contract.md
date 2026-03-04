# VeloVoice AI — API Contract

> Definitive reference for all communication surfaces between frontend, backend, and external clients.
> For architectural context see `docs/architecture.md`.

---

## Table of Contents

1. [Overview](#1-overview)
2. [WebSocket Endpoint](#2-websocket-endpoint)
3. [Client → Server Messages](#3-client--server-messages)
4. [Server → Client Messages](#4-server--client-messages)
5. [Error Codes](#5-error-codes)
6. [HTTP Endpoints](#6-http-endpoints)
7. [Audio Format Reference](#7-audio-format-reference)
8. [WebSocket Close Codes](#8-websocket-close-codes)

---

## 1. Overview

### Base URLs

| Environment | WebSocket              | HTTP                    |
|-------------|------------------------|-------------------------|
| Development | `ws://localhost:8000/ws` | `http://localhost:8000` |
| Production  | `wss://<domain>/ws`    | `https://<domain>`      |

### Surfaces

| Surface    | Protocol  | Purpose                                      |
|------------|-----------|----------------------------------------------|
| WebSocket  | WS / WSS  | Primary — real-time audio + control messages |
| HTTP REST  | HTTP/1.1  | Secondary — health check only                |

### Auth

None in V1. OpenAI API key is held server-side via `.env`. Clients connect without credentials.

### Audio Format (Global)

All binary WebSocket frames carry **PCM signed 16-bit little-endian, 24 kHz, mono** audio.
See [Section 7](#7-audio-format-reference) for full spec.

---

## 2. WebSocket Endpoint

**Endpoint:** `GET /ws` (HTTP upgrade to WebSocket)

### Connection Sequence

```
Client                                  Server
  │                                        │
  │──── HTTP GET /ws (Upgrade) ───────────▶│
  │◀─── 101 Switching Protocols ───────────│
  │                                        │
  │──── session.start (JSON) ─────────────▶│
  │◀─── session.ready (JSON) ──────────────│
  │                                        │
  │──── audio.chunk (binary) ─────────────▶│  ┐
  │──── audio.chunk (binary) ─────────────▶│  │ repeat while
  │──── audio.chunk (binary) ─────────────▶│  │ VAD active
  │                                        │  ┘
  │──── audio.stop (JSON) ────────────────▶│
  │                                        │
  │◀─── transcript.partial (JSON) ─────────│  ┐ 0–N times
  │◀─── transcript.partial (JSON) ─────────│  ┘
  │◀─── transcript.final (JSON) ───────────│
  │                                        │
  │◀─── response.audio (binary) ───────────│  ┐
  │◀─── response.audio (binary) ───────────│  │ repeat until
  │◀─── response.audio (binary) ───────────│  │ response done
  │                                        │  ┘
  │◀─── response.end (JSON) ───────────────│
  │                                        │
  │  (cycle repeats for next utterance)    │
  │                                        │
  │──── session.end (JSON) ───────────────▶│
  │◀─── WS Close 1000 ─────────────────────│
```

### Message Framing

| Frame type | Used for                        |
|------------|---------------------------------|
| Text (JSON)| All control messages            |
| Binary     | Audio chunks (both directions)  |

All JSON messages include a top-level `"type"` field as discriminator.

---

## 3. Client → Server Messages

### `session.start`

Initialize the session. **Must be the first message** after WebSocket connect.
Server responds with `session.ready` or `error`.

```json
{
  "type": "session.start",
  "config": {
    "voice": "alloy"
  }
}
```

**Fields:**

| Field          | Type   | Required | Default  | Description                                                               |
|----------------|--------|----------|----------|---------------------------------------------------------------------------|
| `config.voice` | string | No       | `"alloy"`| OpenAI TTS voice. Options: `alloy \| echo \| fable \| onyx \| nova \| shimmer` |

---

### `audio.chunk`

Raw PCM audio from the microphone. **Binary WebSocket frame — no JSON wrapper.**

- Send continuously while VAD reports speech active.
- Stop sending on VAD silence (send `audio.stop` instead).
- Recommended chunk size: 4096 samples (~256 ms).

**Format:** PCM signed 16-bit LE, 24 kHz, mono. See [Section 7](#7-audio-format-reference).

---

### `audio.stop`

Signal that VAD detected end of speech. Server flushes buffered audio to OpenAI Realtime API
and waits for the response.

```json
{
  "type": "audio.stop"
}
```

No additional fields.

---

### `session.end`

Graceful disconnect. Server closes the OpenAI Realtime session, removes session from store,
and closes the WebSocket with code 1000.

```json
{
  "type": "session.end"
}
```

No additional fields.

---

## 4. Server → Client Messages

### `session.ready`

Sent immediately after a valid `session.start`. Confirms session is created and ready.

```json
{
  "type": "session.ready",
  "session_id": "3f2a1b4c-8d9e-4f7a-b2c3-1a2b3c4d5e6f"
}
```

**Fields:**

| Field        | Type   | Description                              |
|--------------|--------|------------------------------------------|
| `session_id` | string | UUID v4. Use for logging and debugging.  |

---

### `transcript.partial`

Interim STT result streamed during processing. May arrive 0–N times before `transcript.final`.

```json
{
  "type": "transcript.partial",
  "text": "Hello, I'd like to",
  "is_final": false
}
```

**Fields:**

| Field      | Type    | Description                                          |
|------------|---------|------------------------------------------------------|
| `text`     | string  | Current best-guess transcription. May change.        |
| `is_final` | boolean | Always `false` for partial. Differentiate from final.|

Display as live caption. Replace on each new `transcript.partial`.

---

### `transcript.final`

Definitive user utterance. Store in conversation history.

```json
{
  "type": "transcript.final",
  "text": "Hello, I'd like to check my order status.",
  "is_final": true
}
```

**Fields:**

| Field      | Type    | Description                              |
|------------|---------|------------------------------------------|
| `text`     | string  | Final, stable transcription.             |
| `is_final` | boolean | Always `true`.                           |

---

### `response.audio`

A chunk of assistant TTS audio. **Binary WebSocket frame — no JSON wrapper.**

- Same PCM format as input audio: 16-bit LE, 24 kHz, mono.
- Queue chunks in order. Play via AudioWorklet.
- Do not skip or reorder chunks — gapless playback depends on order.

Arrives repeatedly until `response.end` is received.

---

### `response.end`

Signals the full assistant response has been delivered. No more `response.audio` frames follow
for this turn.

```json
{
  "type": "response.end"
}
```

No additional fields. Client should transition UI state: `SPEAKING → CONNECTED`.

---

### `error`

Sent when the server encounters a problem. See [Section 5](#5-error-codes) for all codes.

```json
{
  "type": "error",
  "code": "OPENAI_CONNECTION_FAILED",
  "message": "Could not connect to OpenAI Realtime API",
  "fatal": true
}
```

**Fields:**

| Field     | Type    | Description                                                              |
|-----------|---------|--------------------------------------------------------------------------|
| `code`    | string  | Machine-readable error code. Use for programmatic handling.              |
| `message` | string  | Human-readable description. Display to user or log.                      |
| `fatal`   | boolean | If `true`, server closes WS after sending. Client must reconnect. If `false`, session continues. |

---

## 5. Error Codes

| Code                       | Fatal | Trigger                                                  | Client action                    |
|----------------------------|-------|----------------------------------------------------------|----------------------------------|
| `SESSION_NOT_FOUND`        | false | `audio.chunk` or `audio.stop` before `session.start`    | Send `session.start` first       |
| `INVALID_MESSAGE_TYPE`     | false | Unknown `type` field in JSON frame                       | Fix message type, retry          |
| `INVALID_MESSAGE_SCHEMA`   | false | Required field missing or wrong type                     | Fix schema, retry                |
| `OPENAI_CONNECTION_FAILED` | true  | Backend could not open OpenAI Realtime WebSocket         | Reconnect with exponential backoff |
| `OPENAI_API_ERROR`         | false | OpenAI returned a non-fatal error event                  | Log, continue session            |
| `OPENAI_RATE_LIMITED`      | true  | OpenAI returned 429; session terminated                  | Wait, then reconnect             |
| `SESSION_EXPIRED`          | true  | Session TTL (30 min) exceeded mid-session                | Create new session               |
| `INTERNAL_ERROR`           | true  | Unhandled exception in backend pipeline                  | Reconnect, report if persistent  |

---

## 6. HTTP Endpoints

### `GET /health`

Liveness and readiness check. Used by Docker health checks and load balancers.

**No authentication required.**

#### Response — 200 Healthy

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

#### Response — 503 Unhealthy

```json
{
  "status": "unhealthy",
  "checks": {
    "openai_realtime": "unreachable"
  },
  "active_sessions": 0,
  "uptime_seconds": 120
}
```

**Response fields:**

| Field                         | Type    | Description                                          |
|-------------------------------|---------|------------------------------------------------------|
| `status`                      | string  | `"healthy"` or `"unhealthy"`                         |
| `checks.openai_realtime`      | string  | `"reachable"` or `"unreachable"`                     |
| `active_sessions`             | integer | Current in-memory session count                      |
| `uptime_seconds`              | integer | Seconds since server start                           |

**Headers:** `Content-Type: application/json`

---

## 7. Audio Format Reference

All binary WebSocket frames (both directions) use the same PCM format.

| Property      | Value                   | Notes                                               |
|---------------|-------------------------|-----------------------------------------------------|
| Encoding      | PCM signed 16-bit LE    | Raw samples, no container or file header            |
| Sample rate   | 24,000 Hz               | Recommended by OpenAI for gpt-4o-realtime           |
| Channels      | 1 (mono)                |                                                     |
| Bit depth     | 16-bit                  | 2 bytes per sample                                  |
| Byte order    | Little-endian           |                                                     |
| Chunk size    | ~4096 samples (~256 ms) | Recommended; server accepts any non-zero size       |
| WS frame type | Binary                  | No JSON envelope                                    |
| Direction     | Both                    | Mic capture (client→server) and TTS (server→client) |

**Bytes per second:** 24,000 samples × 2 bytes = **48,000 bytes/s (~47 KB/s)**.

---

## 8. WebSocket Close Codes

| Code | Name                   | Sent by | Meaning                                  | Client action                    |
|------|------------------------|---------|------------------------------------------|----------------------------------|
| 1000 | Normal closure         | Server  | Clean `session.end` shutdown             | None required                    |
| 1001 | Going away             | Server  | Server restart or deploy                 | Reconnect with exponential backoff |
| 1011 | Internal server error  | Server  | Unhandled exception during connection    | Reconnect with exponential backoff |
| 4000 | Fatal application error| Server  | Fatal `error` message was sent first     | Show error to user, offer reconnect |
| 4001 | Session expired        | Server  | TTL exceeded; session cleaned up         | Create new session               |
