"""
Zoho CRM provider — mirrors lib/providers/zoho.ts

Supports contact upsert (search-then-PUT/POST) and note creation.
Handles OAuth refresh token flow with module-level token cache.
Mock-safe when ZOHO_CLIENT_ID/SECRET/REFRESH_TOKEN are not set.
"""
from __future__ import annotations

import os
import time
from typing import Any

import httpx


_TOKEN_CACHE: dict[str, Any] = {}
_TIMEOUT = 12


def _is_configured() -> bool:
    return bool(
        os.getenv("ZOHO_CLIENT_ID")
        and os.getenv("ZOHO_CLIENT_SECRET")
        and os.getenv("ZOHO_REFRESH_TOKEN")
    )


def _region() -> str:
    r = (os.getenv("ZOHO_REGION") or "com").lower().strip(".")
    return r if r else "com"


def _accounts_host() -> str:
    r = _region()
    return f"https://accounts.zoho.{r}"


def _api_host() -> str:
    r = _region()
    return f"https://www.zohoapis.{r}"


def _contact_properties(prospect: dict[str, Any]) -> dict[str, str]:
    name = prospect.get("input_name") or ""
    parts = name.strip().split(None, 1)
    first = parts[0] if parts else ""
    last = parts[1] if len(parts) > 1 else (
        (prospect.get("email") or "").split("@")[0] or "Unknown"
    )
    return {
        "First_Name": first,
        "Last_Name": last,
        "Email": prospect.get("email") or "",
        "Account_Name": prospect.get("input_company") or "",
        "Title": prospect.get("title") or "",
        "LinkedIn_Profile": prospect.get("input_linkedin_url") or "",
        "Description": prospect.get("research_summary") or "",
    }


async def _get_access_token() -> str:
    """Get a valid Zoho access token, refreshing if necessary."""
    now = time.time()
    cached = _TOKEN_CACHE.get(_region())
    if cached and cached.get("expires_at", 0) - 60 > now:
        return cached["access_token"]

    async with httpx.AsyncClient(timeout=10) as client:
        resp = await client.post(
            f"{_accounts_host()}/oauth/v2/token",
            data={
                "grant_type": "refresh_token",
                "client_id": os.getenv("ZOHO_CLIENT_ID", ""),
                "client_secret": os.getenv("ZOHO_CLIENT_SECRET", ""),
                "refresh_token": os.getenv("ZOHO_REFRESH_TOKEN", ""),
            },
        )
    resp.raise_for_status()
    data = resp.json()
    access_token = data["access_token"]
    expires_in = data.get("expires_in", 3600)

    _TOKEN_CACHE[_region()] = {
        "access_token": access_token,
        "expires_at": now + expires_in,
    }
    return access_token


async def push_zoho_contact(prospect: dict[str, Any]) -> dict[str, Any]:
    """Upsert a contact in Zoho CRM by email."""
    if not _is_configured():
        mock_id = f"mock-{abs(hash(prospect.get('email', '')))}"
        return {"contact_id": mock_id, "created": False, "mock": True}

    email = (prospect.get("email") or "").strip()
    if not email:
        raise ValueError("Prospect has no email")

    token = await _get_access_token()
    api_base = f"{_api_host()}/crm/v7"

    # Search for existing contact
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        search_resp = await client.get(
            f"{api_base}/Contacts/search",
            headers={"Authorization": f"Zoho-oauthtoken {token}"},
            params={"email": email},
        )

    fields = _contact_properties(prospect)

    if search_resp.status_code == 200:
        results = search_resp.json().get("data", [])
        if results:
            contact_id = results[0]["id"]
            async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
                await client.put(
                    f"{api_base}/Contacts/{contact_id}",
                    headers={
                        "Authorization": f"Zoho-oauthtoken {token}",
                        "Content-Type": "application/json",
                    },
                    json={"data": [fields]},
                )
            return {"contact_id": contact_id, "created": False}

    # Create new
    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        create_resp = await client.post(
            f"{api_base}/Contacts",
            headers={
                "Authorization": f"Zoho-oauthtoken {token}",
                "Content-Type": "application/json",
            },
            json={"data": [fields]},
        )
    create_resp.raise_for_status()
    contact_id = create_resp.json().get("data", [{}])[0].get("details", {}).get("id", "unknown")
    return {"contact_id": contact_id, "created": True}


async def add_zoho_note(contact_id: str, body: str) -> dict[str, Any]:
    """Add a note to a Zoho CRM contact."""
    if not _is_configured():
        return {"note_id": "mock-note", "mock": True}

    token = await _get_access_token()
    note_body = body[:32_000]  # Zoho note body limit

    async with httpx.AsyncClient(timeout=_TIMEOUT) as client:
        resp = await client.post(
            f"{_api_host()}/crm/v7/Notes",
            headers={
                "Authorization": f"Zoho-oauthtoken {token}",
                "Content-Type": "application/json",
            },
            json={
                "data": [{
                    "Note_Content": note_body,
                    "Parent_Id": contact_id,
                    "se_module": "Contacts",
                }]
            },
        )

    resp.raise_for_status()
    note_id = resp.json().get("data", [{}])[0].get("details", {}).get("id", "unknown")
    return {"note_id": note_id}
