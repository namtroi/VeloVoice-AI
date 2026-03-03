"""Structured JSON logger for VeloVoice AI backend.

All log records are emitted as JSON objects with the following fields:
  timestamp   ISO-8601 UTC string
  level       DEBUG / INFO / WARNING / ERROR / CRITICAL
  action      Caller-supplied event name (e.g. "session_created")
  session_id  Optional session identifier
  duration_ms Optional elapsed time in milliseconds
  metadata    Optional dict of extra key/value pairs
  message     Original log message (if any extra string was passed)
"""

import json
import logging
import sys
from datetime import datetime, timezone
from typing import Any


class JSONFormatter(logging.Formatter):
    """Format log records as single-line JSON."""

    def format(self, record: logging.LogRecord) -> str:
        payload: dict[str, Any] = {
            "timestamp": datetime.now(timezone.utc).isoformat(),
            "level": record.levelname,
            "action": getattr(record, "action", record.getMessage()),
            "session_id": getattr(record, "session_id", None),
            "duration_ms": getattr(record, "duration_ms", None),
            "metadata": getattr(record, "metadata", None),
        }

        # Include the original message only when it differs from action
        msg = record.getMessage()
        if msg and msg != payload["action"]:
            payload["message"] = msg

        # Include exception info if present
        if record.exc_info:
            payload["exc_info"] = self.formatException(record.exc_info)

        # Strip None values to keep output compact
        payload = {k: v for k, v in payload.items() if v is not None}
        return json.dumps(payload)


def get_logger(name: str = "velovoice") -> logging.Logger:
    """Return a logger configured with the JSON formatter.

    Usage::

        log = get_logger(__name__)
        log.info("session_created", extra={"action": "session_created",
                                           "session_id": sid})
    """
    logger = logging.getLogger(name)
    if not logger.handlers:
        handler = logging.StreamHandler(sys.stdout)
        handler.setFormatter(JSONFormatter())
        logger.addHandler(handler)
        logger.setLevel(logging.DEBUG)
        logger.propagate = False
    return logger


# Module-level default logger
logger = get_logger()
