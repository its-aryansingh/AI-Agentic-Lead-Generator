"""
Auth and mailbox OAuth views.

Mirrors:
  - app/api/auth/callback/route.ts  → Google OAuth exchange + users upsert
  - app/api/mailbox/connect/route.ts → Gmail OAuth initiation
  - app/api/mailbox/callback/route.ts → Gmail OAuth callback
  - app/api/extension/replies/[id]/draft-response → Draft reply response
"""
from __future__ import annotations

import os
import urllib.parse
from datetime import UTC, datetime
from typing import Any

from django.http import HttpRequest, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from leadgen_backend.auth import parse_bearer_token
from leadgen_backend.config import get_settings
from leadgen_backend.supabase_rest import SupabaseRest
from leadgen_backend.validators import parse_json_body


CORS_HEADERS = {
    "Access-Control-Allow-Origin": "*",
    "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
    "Access-Control-Allow-Headers": "Content-Type, Authorization",
}


def _cors(response: HttpResponse) -> HttpResponse:
    for k, v in CORS_HEADERS.items():
        response[k] = v
    return response


# ---- /api/auth/callback -------------------------------------------------------

@csrf_exempt
async def auth_callback(request: HttpRequest) -> HttpResponse:
    """
    Google OAuth callback — exchange code for tokens, upsert user row.
    This is called by Supabase Auth after Google OAuth completes.
    For Django backend, we mainly handle the Google refresh token capture
    to enable Sheets export.
    """
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=204))

    if request.method != "GET":
        return _cors(JsonResponse({"error": "method_not_allowed"}, status=405))

    settings = get_settings()
    code = request.GET.get("code")
    next_url = request.GET.get("next", "/app/chat")

    if not code:
        return _cors(HttpResponse("Missing code", status=400))

    # Exchange code via Supabase Auth
    supabase = SupabaseRest(settings)

    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                f"{settings.supabase_url}/auth/v1/token?grant_type=pkce",
                json={"code": code},
                headers={
                    "apikey": settings.supabase_anon_key or "",
                    "Content-Type": "application/json",
                },
            )
        if resp.status_code >= 400:
            return _cors(HttpResponse(f"Auth exchange failed: {resp.text}", status=400))

        data = resp.json()
        access_token = data.get("access_token")
        user = data.get("user", {})
        user_id = user.get("id")
        email = user.get("email")

        if user_id and email:
            await supabase.upsert_user(user_id, email)

        # Capture Google refresh token from provider_token if present
        provider_token = data.get("provider_refresh_token")
        if provider_token and user_id:
            await supabase._patch(
                "users",
                {"id": f"eq.{user_id}"},
                {"google_refresh_token": provider_token},
            )

    except Exception as e:
        return _cors(HttpResponse(f"Auth error: {e}", status=500))

    # Redirect to app
    return HttpResponse(
        f'<html><head><meta http-equiv="refresh" content="0;url={next_url}"></head></html>',
        content_type="text/html",
    )


# ---- /api/mailbox/connect ----------------------------------------------------

@csrf_exempt
async def mailbox_connect(request: HttpRequest) -> HttpResponse:
    """Initiate Gmail OAuth for mailbox connection."""
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=204))

    if request.method != "GET":
        return _cors(JsonResponse({"error": "method_not_allowed"}, status=405))

    settings = get_settings()
    client_id = os.getenv("GOOGLE_CLIENT_ID")
    if not client_id:
        return _cors(JsonResponse({"error": "Google OAuth not configured"}, status=500))

    # Build redirect URI
    host = request.get_host()
    scheme = "https" if request.is_secure() else "http"
    redirect_uri = f"{scheme}://{host}/api/mailbox/callback"

    # Generate OAuth URL
    params = {
        "client_id": client_id,
        "redirect_uri": redirect_uri,
        "response_type": "code",
        "scope": "https://www.googleapis.com/auth/gmail.send https://www.googleapis.com/auth/gmail.readonly",
        "access_type": "offline",
        "prompt": "consent",
    }

    # Include user ID in state for callback
    token = parse_bearer_token(request.headers.get("Authorization"))
    supabase = SupabaseRest(settings)
    auth = await supabase.user_from_token(token)
    if auth.user:
        import base64, json
        state = base64.urlsafe_b64encode(json.dumps({"user_id": auth.user.id}).encode()).decode()
        params["state"] = state

    oauth_url = "https://accounts.google.com/o/oauth2/v2/auth?" + urllib.parse.urlencode(params)
    return HttpResponse(
        f'<html><head><meta http-equiv="refresh" content="0;url={oauth_url}"></head></html>',
        content_type="text/html",
    )


# ---- /api/mailbox/callback ---------------------------------------------------

@csrf_exempt
async def mailbox_callback(request: HttpRequest) -> HttpResponse:
    """Handle Gmail OAuth callback — exchange code for refresh token."""
    if request.method == "OPTIONS":
        return _cors(HttpResponse(status=204))

    if request.method != "GET":
        return _cors(JsonResponse({"error": "method_not_allowed"}, status=405))

    settings = get_settings()
    code = request.GET.get("code")
    state = request.GET.get("state", "")
    error = request.GET.get("error")

    if error:
        return HttpResponse(f"OAuth error: {error}", status=400)

    if not code:
        return HttpResponse("Missing code", status=400)

    client_id = os.getenv("GOOGLE_CLIENT_ID")
    client_secret = os.getenv("GOOGLE_CLIENT_SECRET")
    if not client_id or not client_secret:
        return HttpResponse("Google OAuth not configured", status=500)

    host = request.get_host()
    scheme = "https" if request.is_secure() else "http"
    redirect_uri = f"{scheme}://{host}/api/mailbox/callback"

    import httpx
    try:
        async with httpx.AsyncClient(timeout=10) as client:
            resp = await client.post(
                "https://oauth2.googleapis.com/token",
                data={
                    "code": code,
                    "client_id": client_id,
                    "client_secret": client_secret,
                    "redirect_uri": redirect_uri,
                    "grant_type": "authorization_code",
                },
            )
        if resp.status_code >= 400:
            return HttpResponse(f"Token exchange failed: {resp.text}", status=400)

        tokens = resp.json()
        refresh_token = tokens.get("refresh_token")
        access_token = tokens.get("access_token")

        if not refresh_token:
            return HttpResponse("No refresh token received. Try revoking access and reconnecting.", status=400)

        # Get Gmail address
        email_address = None
        if access_token:
            try:
                async with httpx.AsyncClient(timeout=8) as client2:
                    profile_resp = await client2.get(
                        "https://www.googleapis.com/gmail/v1/users/me/profile",
                        headers={"Authorization": f"Bearer {access_token}"},
                    )
                if profile_resp.status_code == 200:
                    email_address = profile_resp.json().get("emailAddress")
            except Exception:
                pass

        # Extract user_id from state
        user_id = None
        if state:
            try:
                import base64, json
                decoded = json.loads(base64.urlsafe_b64decode(state + "==").decode())
                user_id = decoded.get("user_id")
            except Exception:
                pass

        if user_id and email_address:
            supabase = SupabaseRest(settings)
            # Upsert mailbox record
            await supabase._post("mailboxes", {
                "user_id": user_id,
                "email_address": email_address,
                "oauth_refresh_token": refresh_token,
                "status": "active",
                "warmup_started_at": datetime.now(UTC).isoformat(),
                "daily_sent": 0,
                "daily_send_limit": 50,
                "last_reset_at": datetime.now(UTC).isoformat(),
            }, headers={"Prefer": "resolution=merge-duplicates,return=minimal"})

    except Exception as e:
        return HttpResponse(f"OAuth callback error: {e}", status=500)

    return HttpResponse(
        '<html><head><meta http-equiv="refresh" content="0;url=/app/settings/mailboxes?connected=1"></head></html>',
        content_type="text/html",
    )


# ---- /api/extension/replies/[id]/draft-response -----------------------------

@csrf_exempt
async def extension_reply_draft_response(request: HttpRequest, reply_id: str) -> JsonResponse:
    """Draft a reply response for a given reply classification."""
    if request.method == "OPTIONS":
        return _cors(JsonResponse({}, status=204))

    if request.method != "POST":
        return _cors(JsonResponse({"error": "method_not_allowed"}, status=405))

    token = parse_bearer_token(request.headers.get("Authorization"))
    settings = get_settings()
    supabase = SupabaseRest(settings)
    auth = await supabase.user_from_token(token)
    if not auth.user:
        return _cors(JsonResponse({"error": "unauthorized"}, status=401))

    ctx = {"user_id": auth.user.id, "session_id": ""}

    from leadgen_backend.agent.tool_handlers import handle_draft_reply
    result = await handle_draft_reply(
        {"reply_classification_id": reply_id},
        ctx,
        settings,
        supabase,
    )

    return _cors(JsonResponse(result))
