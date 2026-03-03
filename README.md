# VeloVoice AI

A real-time voice assistant powered by the OpenAI Realtime API. Speak naturally — VeloVoice transcribes, processes, and replies with low-latency audio using WebSockets end-to-end.

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
