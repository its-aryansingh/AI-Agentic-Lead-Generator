"""
WhatsApp BSP provider — mirrors lib/providers/whatsapp.ts

Supports free-form messages + pre-approved templates.
Mock-safe when WHATSAPP_API_URL/KEY/FROM are not set.
"""
from __future__ import annotations

import os
from typing import Any

import httpx


def _is_configured() -> bool:
    return bool(
        os.getenv("WHATSAPP_API_URL")
        and os.getenv("WHATSAPP_API_KEY")
        and os.getenv("WHATSAPP_FROM")
    )


def normalize_whatsapp_number(phone: str) -> str:
    """Normalize to E.164 format (digits only, no leading +)."""
    digits = "".join(c for c in phone if c.isdigit())
    if digits.startswith("0"):
        digits = "91" + digits[1:]  # India default
    return digits


async def send_whatsapp(to: str, body: str) -> dict[str, Any]:
    """Send a free-form WhatsApp message."""
    if not _is_configured():
        return {"mock": True, "to": to, "body": body[:50]}

    api_url = os.getenv("WHATSAPP_API_URL", "")
    api_key = os.getenv("WHATSAPP_API_KEY", "")
    from_number = os.getenv("WHATSAPP_FROM", "")

    normalized = normalize_whatsapp_number(to)

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{api_url.rstrip('/')}/messages",
                json={
                    "messaging_product": "whatsapp",
                    "to": normalized,
                    "type": "text",
                    "text": {"body": body},
                },
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
        resp.raise_for_status()
        return {"ok": True, "to": normalized, **resp.json()}
    except Exception as e:
        return {"ok": False, "error": str(e), "to": normalized}


async def send_whatsapp_template(
    to: str,
    template_name: str,
    language_code: str = "en",
    components: list[dict[str, Any]] | None = None,
) -> dict[str, Any]:
    """Send a pre-approved WhatsApp template message."""
    if not _is_configured():
        return {"mock": True, "to": to, "template": template_name}

    api_url = os.getenv("WHATSAPP_API_URL", "")
    api_key = os.getenv("WHATSAPP_API_KEY", "")

    normalized = normalize_whatsapp_number(to)

    payload: dict[str, Any] = {
        "messaging_product": "whatsapp",
        "to": normalized,
        "type": "template",
        "template": {
            "name": template_name,
            "language": {"code": language_code},
        },
    }
    if components:
        payload["template"]["components"] = components

    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{api_url.rstrip('/')}/messages",
                json=payload,
                headers={
                    "Authorization": f"Bearer {api_key}",
                    "Content-Type": "application/json",
                },
            )
        resp.raise_for_status()
        return {"ok": True, "to": normalized, **resp.json()}
    except Exception as e:
        return {"ok": False, "error": str(e), "to": normalized}


def normalize_whatsapp_payload(payload: dict[str, Any]) -> dict[str, Any]:
    """Normalize incoming WhatsApp webhook payload."""
    messages: list[dict[str, Any]] = []
    statuses: list[dict[str, Any]] = []

    entry_list = payload.get("entry", [])
    for entry in entry_list:
        for change in entry.get("changes", []):
            value = change.get("value", {})
            for msg in value.get("messages", []):
                messages.append({
                    "from": msg.get("from"),
                    "type": msg.get("type"),
                    "body": msg.get("text", {}).get("body") if msg.get("type") == "text" else None,
                    "timestamp": msg.get("timestamp"),
                    "id": msg.get("id"),
                })
            for status in value.get("statuses", []):
                statuses.append({
                    "id": status.get("id"),
                    "status": status.get("status"),
                    "timestamp": status.get("timestamp"),
                    "recipient_id": status.get("recipient_id"),
                })

    return {"messages": messages, "statuses": statuses}
