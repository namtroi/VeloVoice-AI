"""Tool stubs for OpenAI function-calling — Phase 3 scope.

These return placeholder strings. Phase 7 will wire them to real integrations.
"""

import json


TOOL_DEFINITIONS = [
    {
        "type": "function",
        "name": "lookup_order_status",
        "description": "Look up the status of an order by its ID.",
        "parameters": {
            "type": "object",
            "properties": {
                "order_id": {
                    "type": "string",
                    "description": "The order identifier.",
                }
            },
            "required": ["order_id"],
        },
    },
    {
        "type": "function",
        "name": "check_availability",
        "description": "Check product or appointment availability for a given date.",
        "parameters": {
            "type": "object",
            "properties": {
                "date": {
                    "type": "string",
                    "description": "Date in ISO-8601 format (YYYY-MM-DD).",
                }
            },
            "required": ["date"],
        },
    },
    {
        "type": "function",
        "name": "transfer_to_human",
        "description": "Transfer the conversation to a human agent.",
        "parameters": {"type": "object", "properties": {}},
    },
]


def lookup_order_status(order_id: str) -> str:
    """Stub: returns a placeholder order status."""
    return json.dumps({"order_id": order_id, "status": "processing", "stub": True})


def check_availability(date: str) -> str:
    """Stub: returns placeholder availability for a date."""
    return json.dumps({"date": date, "available": True, "stub": True})


def transfer_to_human() -> str:
    """Stub: signals transfer to human agent."""
    return json.dumps({"transferred": True, "stub": True})


TOOL_HANDLERS: dict[str, callable] = {
    "lookup_order_status": lambda args: lookup_order_status(**args),
    "check_availability": lambda args: check_availability(**args),
    "transfer_to_human": lambda _args: transfer_to_human(),
}
