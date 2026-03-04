"""Pydantic message models for the VeloVoice WebSocket protocol.

Client → Server messages use a discriminated union on the ``type`` field.
Server → Client messages are plain dicts (serialised with json.dumps).
"""

from typing import Annotated, Literal

from pydantic import BaseModel, ConfigDict, Field

# ---------------------------------------------------------------------------
# Client → Server models
# ---------------------------------------------------------------------------


class SessionStartConfig(BaseModel):
    # extra="ignore" so old clients that still send `language` don't get a schema error
    model_config = ConfigDict(extra="ignore")
    voice: str = "alloy"


class SessionStartMessage(BaseModel):
    type: Literal["session.start"]
    config: SessionStartConfig = Field(default_factory=SessionStartConfig)


class AudioStopMessage(BaseModel):
    type: Literal["audio.stop"]


class SessionEndMessage(BaseModel):
    type: Literal["session.end"]


ClientMessage = Annotated[
    SessionStartMessage | AudioStopMessage | SessionEndMessage,
    Field(discriminator="type"),
]

# ---------------------------------------------------------------------------
# Server → Client message builders
# ---------------------------------------------------------------------------


def session_ready(session_id: str) -> dict:
    return {"type": "session.ready", "session_id": session_id}


def transcript_partial(text: str, session_id: str | None = None) -> dict:
    return {"type": "transcript.partial", "text": text, "is_final": False, "session_id": session_id}


def transcript_final(text: str, session_id: str | None = None) -> dict:
    return {"type": "transcript.final", "text": text, "is_final": True, "session_id": session_id}


def transcript_user(text: str, session_id: str | None = None) -> dict:
    return {"type": "transcript.user", "text": text, "session_id": session_id}


def response_end(session_id: str | None = None) -> dict:
    return {"type": "response.end", "session_id": session_id}


def error_msg(code: str, message: str, fatal: bool) -> dict:
    return {"type": "error", "code": code, "message": message, "fatal": fatal}
