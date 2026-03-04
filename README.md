# VeloVoice AI

_A Production-Grade, Low-Latency Real-Time Voice Assistant._

## Overview

**VeloVoice AI** is a high-performance, web-based conversational agent designed to mimic human-level interaction speeds. The system utilizes a completely asynchronous **Python (FastAPI)** backend and **WebSockets** to achieve an end-to-end latency mapping of under 1.2 seconds (from user speech completion to initial assistant audio playback).

By leveraging the **OpenAI Realtime API**, the assistant implements an optimistic execution strategy where it begins streaming and synthesizing audio from partial LLM tokens before the full response is generated. This significantly reduces "dead air" during interactive conversations. The frontend is built with **React** and **Vite**, providing a reactive interface that visualizes real-time transcription, audio waveform, and system states.

Key architectural features include:
- **Full-Duplex Audio Streaming:** Audio is captured client-side via the Web Audio API (AudioWorklet) and streamed through WebSockets as binary PCM chunks.
- **Client-Side VAD:** Voice Activity Detection (using `@ricky0123/vad-web`) runs natively in the browser to efficiently determine speech boundaries and reduce bandwidth.
- **Single-Session AI Pipeline:** Employs the OpenAI Realtime API for concurrent STT, LLM, and TTS execution inside a unified WebSocket connection, removing the need for external orchestration frameworks.
- **Minimalist Infra:** Zero database dependencies—utilizes in-memory session stores and Docker Compose for easy deployment.

## Tech Stack

| Layer    | Technology                                      |
|----------|-------------------------------------------------|
| Backend  | FastAPI, uvicorn, Python 3.12                   |
| Frontend | Vite, React, TypeScript, Tailwind CSS, Zustand  |
| AI       | OpenAI Realtime API (`gpt-4o-realtime-preview`) |
| VAD      | `@ricky0123/vad-web`                            |
| Infra    | Docker Compose                                  |

## Quickstart

### 1. Prerequisites

- Docker & Docker Compose
- An OpenAI API key with Realtime API access

### 2. Environment setup

```bash
cp .env.example .env
# Edit .env and set your OPENAI_API_KEY
```

### 3. Run

```bash
docker compose up
```

- Frontend: [http://localhost:3000](http://localhost:3000)
- Backend API: [http://localhost:8000](http://localhost:8000)
- Health check: [http://localhost:8000/health](http://localhost:8000/health)

## Local Development (without Docker)

### Backend

```bash
cd backend
python -m venv .venv && source .venv/bin/activate
pip install -r requirements.txt
uvicorn main:app --reload --port 8000
```

### Frontend

```bash
cd frontend
npm install
npm run dev
```

## Project Structure

```
VeloVoice-AI/
├── backend/
│   ├── main.py              # FastAPI entrypoint
│   ├── config.py            # Env-based settings
│   ├── ws/                  # WebSocket handler + message types
│   ├── pipeline/            # OpenAI Realtime client
│   ├── session/             # Session state store
│   ├── observability/       # Structured logging + health check
│   └── tests/               # pytest test suite
├── frontend/
│   ├── src/
│   │   ├── components/      # VoiceControls, TranscriptPanel, AudioVisualizer
│   │   ├── lib/             # WsClient, audio capture/playback, VAD
│   │   └── stores/          # Zustand session store
│   └── tests/
├── docs/
│   ├── plan.md              # Implementation plan
│   ├── architecture.md      # System architecture
│   └── api-contract.md      # WS/HTTP API contract
├── docker-compose.yml
├── .env.example
└── README.md
```

## Docs

- [Implementation Plan](docs/plan.md)
- [Architecture](docs/architecture.md)
- [API Contract](docs/api-contract.md)
