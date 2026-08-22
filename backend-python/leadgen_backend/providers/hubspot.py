"""
HubSpot CRM provider — mirrors lib/providers/hubspot.ts

Supports contact upsert (search by email → PUT or POST) and note creation.
Mock-safe when HUBSPOT_API_KEY is not set.
"""
from __future__ import annotations

import os
from typing import Any

import httpx


_BASE = "https://api.hubapi.com"
_TIMEOUT = 12


def _is_configured() -> bool:
    return bool(os.getenv("HUBSPOT_API_KEY"))


def _headers() -> dict[str, str]:
    return {
        "Authorization": f"Bearer {os.getenv('HUBSPOT_API_KEY', '')}",
        "Content-Type": "application/json",
    }


def _contact_to_properties(prospect: dict[str, Any]) -> dict[str, str]:
    name = prospect.get("input_name") or ""
    parts = name.strip().split(None, 1)
    first = parts[0] if parts else ""
    last = parts[1] if len(parts) > 1 else ""
    return {
        "email": prospect.get("email") or "",
        "firstname": first,
        "lastname": last,
        "company": prospect.get("input_company") or "",
        "jobtitle": prospect.get("title") or "",
        "linkedin": prospect.get("input_linkedin_url") or "",
    }


async def push_hubspot_contact(prospect: dict[str, Any]) -> dict[str, Any]:
    """Upsert a contact in HubSpot by email. Returns {contact_id, created}."""
    if not _is_configured():
        mock_id = f"mock-{abs(hash(prospect.get('email', '')))}"
        return {"contact_id": mock_id, "created": False, "mock": True}

    email = (prospect.get("email") or "").strip()
    if not email:
        raise ValueError("Prospect has no email")

    # Search for existing contact
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        search_resp = await client.post(
            f"{_BASE}/crm/v3/objects/contacts/search",
            headers=_headers(),
            json={
                "filterGroups": [{"filters": [{"propertyName": "email", "operator": "EQ", "value": email}]}],
                "properties": ["email"],
                "limit": 1,
            },
        )

    properties = _contact_to_properties(prospect)

    if search_resp.status_code == 200:
        results = search_resp.json().get("results", [])
        if results:
            contact_id = results[0]["id"]
            # Update existing
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                await client.patch(
                    f"{_BASE}/crm/v3/objects/contacts/{contact_id}",
                    headers=_headers(),
                    json={"properties": properties},
                )
            return {"contact_id": contact_id, "created": False}

    # Create new
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        create_resp = await client.post(
            f"{_BASE}/crm/v3/objects/contacts",
            headers=_headers(),
            json={"properties": properties},
        )

    if create_resp.status_code == 409:
        # Duplicate — fetch existing
        dup_id = create_resp.json().get("message", "").split("vid=")[-1].split(")")[0]
        return {"contact_id": dup_id or "unknown", "created": False}

    create_resp.raise_for_status()
    contact_id = create_resp.json().get("id", "unknown")
    return {"contact_id": contact_id, "created": True}


async def add_hubspot_note(contact_id: str, body: str) -> dict[str, Any]:
    """Add a note to a HubSpot contact."""
    if not _is_configured():
        return {"note_id": "mock-note", "mock": True}

    note_body = body[:10_000]  # HubSpot note body limit

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{_BASE}/crm/v3/objects/notes",
            headers=_headers(),
            json={
                "properties": {"hs_note_body": note_body},
                "associations": [{
                    "to": {"id": contact_id},
                    "types": [{"associationCategory": "HUBSPOT_DEFINED", "associationTypeId": 202}],
                }],
            },
        )

    resp.raise_for_status()
    return {"note_id": resp.json().get("id", "unknown")}
