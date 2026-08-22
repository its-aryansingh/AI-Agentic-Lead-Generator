from __future__ import annotations

import json
from dataclasses import dataclass
from datetime import UTC, datetime, timedelta
from time import monotonic
from typing import Any, Awaitable, Callable

import httpx

from leadgen_backend.auth import AuthResult, AuthUser, looks_like_jwt
from leadgen_backend.config import Settings


@dataclass(frozen=True)
class DbPing:
    ok: bool
    latency_ms: int | None
    error: str | None = None


@dataclass(frozen=True)
class UpsertResult:
    ok: bool
    id: str | None = None
    created: bool = False
    error: str | None = None


@dataclass(frozen=True)
class MutationResult:
    ok: bool
    data: dict[str, Any] | None = None
    error: str | None = None
    status: int = 200


class SupabaseRest:
    def __init__(self, settings: Settings) -> None:
        self.settings = settings

    @property
    def configured(self) -> bool:
        return bool(self.settings.supabase_url and self.settings.supabase_service_role_key)

    async def ping_users(self) -> DbPing:
        if not self.settings.supabase_url:
            return DbPing(ok=False, latency_ms=None, error="SUPABASE_URL unset")
        if not self.settings.supabase_service_role_key:
            return DbPing(ok=False, latency_ms=None, error="SUPABASE_SERVICE_ROLE_KEY unset")

        started = monotonic()
        url = f"{self.settings.supabase_url}/rest/v1/users"
        headers = self._service_headers() | {"Prefer": "count=exact"}
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.head(url, params={"select": "id", "limit": "1"}, headers=headers)
            latency = round((monotonic() - started) * 1000)
            if response.status_code >= 400:
                return DbPing(ok=False, latency_ms=latency, error=response.text[:200])
            return DbPing(ok=True, latency_ms=latency)
        except httpx.HTTPError as exc:
            return DbPing(
                ok=False,
                latency_ms=round((monotonic() - started) * 1000),
                error=str(exc),
            )

    async def user_from_token(self, token: str | None) -> AuthResult:
        if not token:
            return AuthResult(user=None, reason="missing_bearer")
        if not looks_like_jwt(token):
            return AuthResult(user=None, reason="malformed_bearer")
        if not self.configured:
            return AuthResult(user=None, reason="supabase_admin_unconfigured")

        url = f"{self.settings.supabase_url}/auth/v1/user"
        headers = self._service_headers() | {"Authorization": f"Bearer {token}"}
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get(url, headers=headers)
        except httpx.HTTPError as exc:
            return AuthResult(user=None, reason=f"auth_lookup_failed:{exc}")

        if response.status_code != 200:
            return AuthResult(user=None, reason="invalid_bearer")

        payload = response.json()
        user_id = payload.get("id")
        if not isinstance(user_id, str):
            return AuthResult(user=None, reason="invalid_supabase_user")
        email = payload.get("email") if isinstance(payload.get("email"), str) else None
        return AuthResult(user=AuthUser(id=user_id, email=email))

    async def get_profile(self, user_id: str) -> dict[str, Any] | None:
        if not self.configured:
            return None
        url = f"{self.settings.supabase_url}/rest/v1/users"
        params = {
            "select": "plan,credits_remaining,notify_whatsapp,whatsapp_number,voice_anchor_text,google_refresh_token",
            "id": f"eq.{user_id}",
            "limit": "1",
        }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get(url, params=params, headers=self._service_headers())
        except httpx.HTTPError:
            return None
        if response.status_code >= 400:
            return None
        rows = response.json()
        if isinstance(rows, list) and rows and isinstance(rows[0], dict):
            return rows[0]
        return None

    # ---- Phase 2 additions ----

    async def upsert_push_token(
        self,
        user_id: str,
        token: str,
        provider: str,
        platform: str | None = None,
        device_id: str | None = None,
    ) -> UpsertResult:
        if not self.configured:
            return UpsertResult(ok=False, error="supabase_admin_unconfigured")

        url = f"{self.settings.supabase_url}/rest/v1/push_tokens"
        now = datetime.now(UTC).isoformat()
        payload = {
            "user_id": user_id,
            "token": token,
            "provider": provider,
            "platform": platform,
            "device_id": device_id,
            "last_seen_at": now,
        }
        headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "return=representation,resolution=merge-duplicates",
        }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.post(url, json=payload, headers=headers)
        except httpx.HTTPError as exc:
            return UpsertResult(ok=False, error=str(exc))

        if response.status_code >= 400:
            return UpsertResult(ok=False, error=response.text[:200])

        rows = response.json()
        if isinstance(rows, list) and rows:
            row = rows[0]
            created_at = row.get("created_at", "")
            last_seen = row.get("last_seen_at", "")
            created = _same_timestamp(created_at, last_seen)
            return UpsertResult(ok=True, id=row.get("id"), created=created)
        return UpsertResult(ok=False, error="upsert returned no data")

    async def get_alerts(
        self,
        user_id: str,
        since: str | None = None,
    ) -> dict[str, Any]:
        if not self.configured:
            return {"alerts": [], "server_time": datetime.now(UTC).isoformat()}

        max_per_kind = 15
        alerts: list[dict[str, Any]] = []

        replies = await self._fetch_reply_alerts(user_id, since, max_per_kind)
        for r in replies:
            wants_meeting = bool(r.get("wants_meeting"))
            category = r.get("category", "unknown")
            alerts.append({
                "kind": "hot_reply",
                "id": f"reply:{r['id']}",
                "ts": r.get("created_at", ""),
                "title": f"New {category} reply" + (" 📅" if wants_meeting else ""),
                "body": _shorten(r.get("snippet") or "", 160),
                "meta": {
                    "reply_id": r["id"],
                    "recipient_id": r.get("recipient_id"),
                    "category": category,
                    "wants_meeting": wants_meeting,
                },
            })

        cutoff = since or (datetime.now(UTC) - timedelta(hours=24)).isoformat()
        runs = await self._fetch_automation_run_alerts(user_id, cutoff, max_per_kind)

        auto_ids = list({r["automation_id"] for r in runs if r.get("automation_id")})
        name_map = await self._fetch_automation_names(auto_ids) if auto_ids else {}

        for run in runs:
            name = name_map.get(run.get("automation_id", ""), "Automation")
            status = run.get("status", "unknown")
            alerts.append({
                "kind": "automation_done",
                "id": f"run:{run['id']}",
                "ts": run.get("finished_at", ""),
                "title": f"{name} finished" if status == "completed" else f"{name} failed",
                "body": _shorten(
                    (run.get("summary") or "Completed.") if status == "completed"
                    else (run.get("error") or "Failed."),
                    160,
                ),
                "meta": {
                    "run_id": run["id"],
                    "automation_id": run.get("automation_id"),
                    "status": status,
                },
            })

        alerts.sort(key=lambda a: a.get("ts", ""), reverse=True)
        return {
            "alerts": alerts[:20],
            "server_time": datetime.now(UTC).isoformat(),
        }

    async def handle_reply(self, user_id: str, reply_id: str) -> MutationResult:
        if not self.configured:
            return MutationResult(ok=False, error="supabase_admin_unconfigured", status=500)

        url = f"{self.settings.supabase_url}/rest/v1/reply_classifications"
        params = {
            "id": f"eq.{reply_id}",
            "user_id": f"eq.{user_id}",
            "select": "id,handled",
        }
        headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.patch(
                    url,
                    json={"handled": True},
                    params=params,
                    headers=headers,
                )
        except httpx.HTTPError as exc:
            return MutationResult(ok=False, error=str(exc), status=500)

        if response.status_code >= 400:
            return MutationResult(ok=False, error=response.text[:200], status=400)

        rows = response.json()
        if isinstance(rows, list) and rows:
            return MutationResult(ok=True, data=rows[0])
        return MutationResult(ok=False, error="reply not found", status=404)

    async def update_prospect_stage(
        self,
        user_id: str,
        prospect_id: str,
        stage: str,
    ) -> MutationResult:
        if not self.configured:
            return MutationResult(ok=False, error="supabase_admin_unconfigured", status=500)

        url = f"{self.settings.supabase_url}/rest/v1/prospects"
        params = {
            "id": f"eq.{prospect_id}",
            "select": "id,stage",
        }
        headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.patch(
                    url,
                    json={"stage": stage},
                    params=params,
                    headers=headers,
                )
        except httpx.HTTPError as exc:
            return MutationResult(ok=False, error=str(exc), status=500)

        if response.status_code >= 400:
            return MutationResult(ok=False, error=response.text[:200], status=400)

        rows = response.json()
        if isinstance(rows, list) and rows:
            return MutationResult(ok=True, data=rows[0])
        return MutationResult(ok=False, error="prospect not found", status=404)

    async def upgrade_user_plan(
        self,
        user_id: str,
        plan: str,
        idempotency_key: str,
        provider: str,
        credits_to_add: int,
    ) -> MutationResult:
        if not self.configured:
            return MutationResult(ok=False, error="supabase_admin_unconfigured", status=500)
            
        url_events = f"{self.settings.supabase_url}/rest/v1/webhook_events"
        headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        
        # 1. Check idempotency (or we can just try to insert and catch conflict, but we do it safely here)
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                res_check = await client.get(
                    url_events,
                    params={"id": f"eq.{idempotency_key}", "select": "id"},
                    headers=self._service_headers()
                )
                if res_check.status_code < 400 and isinstance(res_check.json(), list) and len(res_check.json()) > 0:
                    return MutationResult(ok=True, data={"skipped": True, "reason": "already_processed"})
                
                # 2. Insert event
                res_ins = await client.post(
                    url_events,
                    json={
                        "id": idempotency_key,
                        "provider": provider,
                        "payload": {"plan": plan, "userId": user_id, "type": "billing.upgrade"}
                    },
                    headers=headers
                )
                if res_ins.status_code >= 400:
                    return MutationResult(ok=False, error=res_ins.text[:200], status=400)
                
                # 3. Update user
                url_users = f"{self.settings.supabase_url}/rest/v1/users"
                reset_at = (datetime.now(UTC) + timedelta(days=30)).isoformat()
                res_user = await client.patch(
                    url_users,
                    json={
                        "plan": plan,
                        "credits_remaining": credits_to_add,
                        "credits_reset_at": reset_at,
                    },
                    params={"id": f"eq.{user_id}"},
                    headers=headers
                )
                if res_user.status_code >= 400:
                    return MutationResult(ok=False, error="failed to update user plan", status=400)
                    
                # 4. Ledger entry
                url_ledger = f"{self.settings.supabase_url}/rest/v1/credit_transactions"
                res_ledger = await client.post(
                    url_ledger,
                    json={
                        "user_id": user_id,
                        "delta": credits_to_add,
                        "reason": f"plan_upgrade_{plan}"
                    },
                    headers=headers
                )
                return MutationResult(ok=True)
        except httpx.HTTPError as exc:
            return MutationResult(ok=False, error=str(exc), status=500)

    async def set_subscription_status(
        self,
        subscription_id: str,
        status: str,
    ) -> MutationResult:
        if not self.configured:
            return MutationResult(ok=False, error="supabase_admin_unconfigured", status=500)
            
        url = f"{self.settings.supabase_url}/rest/v1/users"
        headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                res = await client.patch(
                    url,
                    json={"subscription_status": status},
                    params={"razorpay_subscription_id": f"eq.{subscription_id}"},
                    headers=headers
                )
                if res.status_code >= 400:
                    return MutationResult(ok=False, error=res.text[:200], status=400)
                return MutationResult(ok=True)
        except httpx.HTTPError as exc:
            return MutationResult(ok=False, error=str(exc), status=500)

    async def handle_whatsapp_webhook(
        self,
        messages: list[dict[str, Any]],
        statuses: list[dict[str, Any]],
    ) -> dict[str, int]:
        if not self.configured:
            return {"received": 0, "opted_out": 0, "replies": 0, "status_updates": 0}
            
        import re
        def _normalize_phone(s: str) -> str:
            return re.sub(r'[^\d]', '', s)

        opted_out = 0
        replies = 0
        status_updates = 0
        
        headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        
        try:
            async with httpx.AsyncClient(timeout=12) as client:
                for m in messages:
                    msg_id = m.get("id")
                    if not msg_id: continue
                    idemp = f"whatsapp:msg:{msg_id}"
                    
                    # idempotency
                    res_chk = await client.get(
                        f"{self.settings.supabase_url}/rest/v1/webhook_events",
                        params={"id": f"eq.{idemp}", "select": "id"},
                        headers=self._service_headers()
                    )
                    if res_chk.status_code < 400 and res_chk.json():
                        continue
                        
                    await client.post(
                        f"{self.settings.supabase_url}/rest/v1/webhook_events",
                        json={"id": idemp, "provider": "whatsapp", "payload": m},
                        headers=headers
                    )
                    
                    phone = _normalize_phone(m.get("from", ""))
                    if not phone: continue
                    
                    # Match prospects
                    res_p = await client.get(
                        f"{self.settings.supabase_url}/rest/v1/prospects",
                        params={"phone": f"eq.{phone}", "select": "id,job_id"},
                        headers=self._service_headers()
                    )
                    prospects = res_p.json() if res_p.status_code < 400 else []
                    prospect_ids = [p["id"] for p in prospects if isinstance(p, dict) and p.get("id")]
                    
                    # Opt out check
                    from leadgen_backend.webhooks import is_opt_out_text
                    if is_opt_out_text(m.get("text", "")):
                        if prospect_ids:
                            p_ids_csv = ",".join(prospect_ids)
                            await client.patch(
                                f"{self.settings.supabase_url}/rest/v1/prospects",
                                json={"whatsapp_opted_out": True},
                                params={"id": f"in.({p_ids_csv})"},
                                headers=headers
                            )
                            await client.patch(
                                f"{self.settings.supabase_url}/rest/v1/campaign_recipients",
                                json={"status": "unsubscribed"},
                                params={
                                    "prospect_id": f"in.({p_ids_csv})",
                                    "channel": "eq.whatsapp",
                                    "status": "in.(scheduled,sent)"
                                },
                                headers=headers
                            )
                        opted_out += 1
                        continue
                        
                    if not prospect_ids: continue
                    p_ids_csv = ",".join(prospect_ids)
                    
                    # Find latest campaign recipient
                    res_r = await client.get(
                        f"{self.settings.supabase_url}/rest/v1/campaign_recipients",
                        params={
                            "channel": "eq.whatsapp",
                            "prospect_id": f"in.({p_ids_csv})",
                            "select": "id,user_id,status",
                            "order": "created_at.desc",
                            "limit": "1"
                        },
                        headers=self._service_headers()
                    )
                    recs = res_r.json() if res_r.status_code < 400 else []
                    if not recs: continue
                    rec = recs[0]
                    if rec.get("status") in ("replied", "unsubscribed", "bounced"):
                        continue
                        
                    # Mark replied
                    await client.patch(
                        f"{self.settings.supabase_url}/rest/v1/campaign_recipients",
                        json={"status": "replied", "reply_at": datetime.now(UTC).isoformat()},
                        params={"id": f"eq.{rec['id']}"},
                        headers=headers
                    )
                    
                    # Insert classification
                    await client.post(
                        f"{self.settings.supabase_url}/rest/v1/reply_classifications",
                        json={
                            "recipient_id": rec["id"],
                            "user_id": rec["user_id"],
                            "category": "other",
                            "confidence": 0.5,
                            "snippet": m.get("text", "")[:500],
                            "needs_human": True,
                            "handled": False
                        },
                        headers=headers
                    )
                    replies += 1

                for s in statuses:
                    s_id = s.get("id")
                    st = s.get("status")
                    if not s_id or not st: continue
                    idemp = f"whatsapp:status:{s_id}:{st}"
                    
                    # idempotency
                    res_chk = await client.get(
                        f"{self.settings.supabase_url}/rest/v1/webhook_events",
                        params={"id": f"eq.{idemp}", "select": "id"},
                        headers=self._service_headers()
                    )
                    if res_chk.status_code < 400 and res_chk.json():
                        continue
                        
                    await client.post(
                        f"{self.settings.supabase_url}/rest/v1/webhook_events",
                        json={"id": idemp, "provider": "whatsapp", "payload": s},
                        headers=headers
                    )
                    
                    if st in ("failed", "undelivered"):
                        reason = s.get("reason") or st
                        await client.patch(
                            f"{self.settings.supabase_url}/rest/v1/campaign_recipients",
                            json={"status": "failed", "bounce_reason": reason[:280]},
                            params={
                                "message_id": f"eq.{s_id}",
                                "channel": "eq.whatsapp"
                            },
                            headers=headers
                        )
                        status_updates += 1
                        
        except httpx.HTTPError:
            pass
            
        return {
            "received": len(messages) + len(statuses),
            "opted_out": opted_out,
            "replies": replies,
            "status_updates": status_updates
        }

    async def get_or_set_cache(
        self,
        key: str,
        ttl_seconds: int,
        fetch_fn: Callable[[], Awaitable[Any]],
    ) -> Any:
        if not self.configured:
            return await fetch_fn()

        url = f"{self.settings.supabase_url}/rest/v1/scrape_cache"
        params = {"key": f"eq.{key}", "select": "value,fetched_at", "limit": "1"}
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get(url, params=params, headers=self._service_headers())
            if response.status_code < 400:
                rows = response.json()
                if isinstance(rows, list) and rows:
                    row = rows[0]
                    fetched_at = row.get("fetched_at", "")
                    if fetched_at and not _is_expired(fetched_at, ttl_seconds):
                        value = row.get("value")
                        if isinstance(value, str):
                            return json.loads(value)
                        return value
        except httpx.HTTPError:
            pass

        result = await fetch_fn()

        now = datetime.now(UTC).isoformat()
        value_str = json.dumps(result, default=str)
        upsert_headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                await client.post(
                    url,
                    json={"key": key, "value": value_str, "fetched_at": now},
                    headers=upsert_headers,
                )
        except httpx.HTTPError:
            pass

        return result

    # ---- agent support methods ----

    async def get_cached(self, key: str) -> Any | None:
        """Get a cached value from scrape_cache."""
        if not self.configured:
            return None
        rows = await self._get("scrape_cache", {"key": f"eq.{key}", "select": "value,fetched_at,ttl_seconds"})
        if not rows:
            return None
        row = rows[0]
        if _is_expired(row.get("fetched_at", ""), row.get("ttl_seconds", 0)):
            return None
        return row.get("value")

    async def set_cache(self, key: str, value: Any, ttl_seconds: int) -> None:
        """Set a value in scrape_cache (upsert)."""
        if not self.configured:
            return
        url = f"{self.settings.supabase_url}/rest/v1/scrape_cache"
        headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "resolution=merge-duplicates",
        }
        payload = {
            "key": key,
            "value": value,
            "ttl_seconds": ttl_seconds,
            "fetched_at": datetime.now(UTC).isoformat(),
        }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                await client.post(url, json=payload, headers=headers)
        except httpx.HTTPError:
            pass

    async def get_or_set_cache(self, key: str, ttl_seconds: int, fetch_fn) -> Any:
        cached = await self.get_cached(key)
        if cached is not None:
            return cached
        value = await fetch_fn()
        await self.set_cache(key, value, ttl_seconds)
        return value

    async def insert_prospect_candidates(self, rows: list[dict[str, Any]]) -> list[dict[str, Any]] | None:
        if not self.configured or not rows:
            return None
        url = f"{self.settings.supabase_url}/rest/v1/prospect_candidates"
        headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                res = await client.post(url, json=rows, headers=headers)
            if res.status_code < 400:
                return res.json()
        except httpx.HTTPError:
            pass
        return None

    async def get_candidates_by_ids(self, ids: list[str]) -> list[dict[str, Any]] | None:
        if not self.configured or not ids:
            return None
        ids_csv = ",".join(ids)
        return await self._get("prospect_candidates", {
            "id": f"in.({ids_csv})",
            "select": "id,preview,source",
        })

    async def get_session_candidates(self, session_id: str) -> list[dict[str, Any]] | None:
        if not self.configured:
            return None
        return await self._get("prospect_candidates", {
            "session_id": f"eq.{session_id}",
            "select": "id,preview,source",
        })

    async def check_credits(self, user_id: str, needed: int) -> dict[str, Any]:
        profile = await self.get_profile(user_id)
        if not profile:
            return {"ok": False, "remaining": 0}
        remaining = profile.get("credits_remaining", 0)
        return {"ok": remaining >= needed, "remaining": remaining}

    async def deduct_credits(self, user_id: str, amount: int) -> bool:
        if not self.configured:
            return False
        ok = await self._patch(
            "users",
            {"id": f"eq.{user_id}"},
            {"credits_remaining": f"credits_remaining - {amount}"},
        )
        if ok:
            await self._post("credit_transactions", {
                "user_id": user_id,
                "delta": -amount,
                "reason": "bulk_enrich",
            })
        return ok

    async def create_job(self, user_id: str, session_id: str, prospect_count: int) -> dict[str, Any] | None:
        if not self.configured:
            return {"id": "mock-job-id"}
        url = f"{self.settings.supabase_url}/rest/v1/jobs"
        headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        payload = {
            "user_id": user_id,
            "session_id": session_id,
            "status": "processing",
            "prospect_count": prospect_count,
        }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                res = await client.post(url, json=payload, headers=headers)
            if res.status_code < 400:
                rows = res.json()
                if isinstance(rows, list) and rows:
                    return rows[0]
        except httpx.HTTPError:
            pass
        return None

    async def update_job_status(self, job_id: str, status: str, enriched_count: int) -> None:
        await self._patch("jobs", {"id": f"eq.{job_id}"}, {
            "status": status,
            "enriched_count": enriched_count,
            "finished_at": datetime.now(UTC).isoformat(),
        })

    async def update_job_sheet(self, job_id: str, sheet_url: str) -> None:
        await self._patch("jobs", {"id": f"eq.{job_id}"}, {"sheet_url": sheet_url})

    async def insert_prospects(self, rows: list[dict[str, Any]]) -> None:
        if not self.configured or not rows:
            return
        url = f"{self.settings.supabase_url}/rest/v1/prospects"
        headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        try:
            async with httpx.AsyncClient(timeout=30) as client:
                await client.post(url, json=rows, headers=headers)
        except httpx.HTTPError:
            pass

    async def get_latest_completed_job(self, user_id: str) -> dict[str, Any] | None:
        rows = await self._get("jobs", {
            "user_id": f"eq.{user_id}",
            "status": "eq.completed",
            "select": "id,created_at",
            "order": "created_at.desc",
            "limit": "1",
        })
        return rows[0] if rows else None

    async def get_job_prospects(self, job_id: str, user_id: str) -> list[dict[str, Any]] | None:
        return await self._get("prospects", {
            "job_id": f"eq.{job_id}",
            "select": "id,input_name,input_company,input_linkedin_url,email,email_confidence,research_summary,email_subject,email_body,talking_points,stage",
        })

    async def get_suppression_hashes(self, user_id: str) -> list[str] | None:
        rows = await self._get("email_suppressions", {
            "user_id": f"eq.{user_id}",
            "select": "email_hash",
        })
        if rows is None:
            return []
        return [r.get("email_hash", "") for r in rows if r.get("email_hash")]

    async def create_campaign(
        self,
        user_id: str,
        name: str,
        job_id: str,
        mailbox_id: str,
        sequence_id: str | None = None,
    ) -> dict[str, Any] | None:
        if not self.configured:
            return {"id": "mock-campaign-id"}
        url = f"{self.settings.supabase_url}/rest/v1/campaigns"
        headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        payload: dict[str, Any] = {
            "user_id": user_id,
            "name": name,
            "job_id": job_id,
            "mailbox_id": mailbox_id,
            "status": "active",
        }
        if sequence_id:
            payload["sequence_id"] = sequence_id
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                res = await client.post(url, json=payload, headers=headers)
            if res.status_code < 400:
                rows = res.json()
                if isinstance(rows, list) and rows:
                    return rows[0]
        except httpx.HTTPError:
            pass
        return None

    async def insert_campaign_recipient(self, row: dict[str, Any]) -> None:
        await self._post("campaign_recipients", row, headers={
            "Prefer": "return=minimal",
        })

    async def upsert_user(self, user_id: str, email: str) -> None:
        if not self.configured:
            return
        url = f"{self.settings.supabase_url}/rest/v1/users"
        headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "resolution=ignore-duplicates,return=minimal",
        }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                await client.post(url, json={"id": user_id, "email": email}, headers=headers)
        except httpx.HTTPError:
            pass

    async def verify_session_ownership(self, session_id: str, user_id: str) -> bool:
        rows = await self._get("chat_sessions", {
            "id": f"eq.{session_id}",
            "user_id": f"eq.{user_id}",
            "select": "id",
        })
        return bool(rows)

    async def create_chat_session(self, user_id: str, title: str) -> dict[str, Any] | None:
        if not self.configured:
            import uuid as _uuid
            return {"id": str(_uuid.uuid4())}
        url = f"{self.settings.supabase_url}/rest/v1/chat_sessions"
        headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "return=representation",
        }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                res = await client.post(url, json={"user_id": user_id, "title": title}, headers=headers)
            if res.status_code < 400:
                rows = res.json()
                if isinstance(rows, list) and rows:
                    return rows[0]
        except httpx.HTTPError:
            pass
        return None

    async def insert_chat_message(self, session_id: str, role: str, content: Any) -> None:
        if not self.configured:
            return
        import json as _json
        payload = {
            "session_id": session_id,
            "role": role,
            "content": content if isinstance(content, (dict, list)) else {"text": str(content)},
        }
        url = f"{self.settings.supabase_url}/rest/v1/chat_messages"
        headers = self._service_headers() | {
            "Content-Type": "application/json",
            "Prefer": "return=minimal",
        }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                await client.post(url, json=payload, headers=headers)
        except httpx.HTTPError:
            pass

    async def set_subscription_status(self, subscription_id: str, status: str) -> None:
        await self._patch("subscriptions", {"id": f"eq.{subscription_id}"}, {"status": status})

    async def handle_whatsapp_webhook(
        self,
        messages: list[dict[str, Any]],
        statuses: list[dict[str, Any]],
    ) -> dict[str, Any]:
        return {"messages_processed": len(messages), "statuses_processed": len(statuses)}

    # ---- generic db helpers ----

    async def _get(self, table: str, params: dict[str, str], headers: dict[str, str] | None = None) -> list[dict[str, Any]] | None:
        if not self.configured: return None
        url = f"{self.settings.supabase_url}/rest/v1/{table}"
        h = self._service_headers()
        if headers:
            h = h | headers
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                res = await client.get(url, params=params, headers=h)
            if res.status_code < 400:
                data = res.json()
                return data if isinstance(data, list) else []
        except httpx.HTTPError:
            pass
        return None

    async def _post(self, table: str, json_data: dict[str, Any] | list[dict[str, Any]], headers: dict[str, str] | None = None, params: dict[str, str] | None = None) -> bool:
        if not self.configured: return False
        url = f"{self.settings.supabase_url}/rest/v1/{table}"
        h = self._service_headers() | {"Content-Type": "application/json"}
        if headers:
            h.update(headers)
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                res = await client.post(url, json=json_data, headers=h, params=params)
            return res.status_code < 400
        except httpx.HTTPError:
            return False

    async def _patch(self, table: str, params: dict[str, str], json_data: dict[str, Any], headers: dict[str, str] | None = None) -> bool:
        if not self.configured: return False
        url = f"{self.settings.supabase_url}/rest/v1/{table}"
        h = self._service_headers() | {"Content-Type": "application/json"}
        if headers:
            h.update(headers)
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                res = await client.patch(url, params=params, json=json_data, headers=h)
            return res.status_code < 400
        except httpx.HTTPError:
            return False

    # ---- private helpers ----

    async def _fetch_reply_alerts(
        self,
        user_id: str,
        since: str | None,
        limit: int,
    ) -> list[dict[str, Any]]:
        url = f"{self.settings.supabase_url}/rest/v1/reply_classifications"
        params: dict[str, str] = {
            "select": "id,category,snippet,created_at,recipient_id,wants_meeting",
            "user_id": f"eq.{user_id}",
            "needs_human": "eq.true",
            "handled": "eq.false",
            "order": "created_at.desc",
            "limit": str(limit),
        }
        if since:
            params["created_at"] = f"gt.{since}"
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get(url, params=params, headers=self._service_headers())
            if response.status_code < 400:
                rows = response.json()
                return rows if isinstance(rows, list) else []
        except httpx.HTTPError:
            pass
        return []

    async def _fetch_automation_run_alerts(
        self,
        user_id: str,
        cutoff: str,
        limit: int,
    ) -> list[dict[str, Any]]:
        url = f"{self.settings.supabase_url}/rest/v1/automation_runs"
        params: dict[str, str] = {
            "select": "id,automation_id,status,summary,error,finished_at",
            "user_id": f"eq.{user_id}",
            "finished_at": f"not.is.null,gt.{cutoff}",
            "status": "in.(completed,failed)",
            "order": "finished_at.desc",
            "limit": str(limit),
        }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get(url, params=params, headers=self._service_headers())
            if response.status_code < 400:
                rows = response.json()
                return rows if isinstance(rows, list) else []
        except httpx.HTTPError:
            pass
        return []

    async def _fetch_automation_names(
        self,
        automation_ids: list[str],
    ) -> dict[str, str]:
        url = f"{self.settings.supabase_url}/rest/v1/automations"
        ids_csv = ",".join(automation_ids)
        params = {
            "select": "id,name",
            "id": f"in.({ids_csv})",
        }
        try:
            async with httpx.AsyncClient(timeout=8) as client:
                response = await client.get(url, params=params, headers=self._service_headers())
            if response.status_code < 400:
                rows = response.json()
                if isinstance(rows, list):
                    return {r["id"]: r.get("name", "Automation") for r in rows if isinstance(r, dict)}
        except httpx.HTTPError:
            pass
        return {}

    def _service_headers(self) -> dict[str, str]:
        key = self.settings.supabase_service_role_key or ""
        return {
            "apikey": key,
            "Authorization": f"Bearer {key}",
        }


def _same_timestamp(a: str, b: str) -> bool:
    try:
        from datetime import datetime as dt
        da = dt.fromisoformat(a.replace("Z", "+00:00"))
        db = dt.fromisoformat(b.replace("Z", "+00:00"))
        return abs((db - da).total_seconds()) < 1
    except (ValueError, TypeError):
        return False


def _shorten(s: str, max_len: int = 160) -> str:
    import re
    trimmed = re.sub(r"\s+", " ", s).strip()
    if len(trimmed) <= max_len:
        return trimmed
    return trimmed[: max_len - 1] + "…"


def _is_expired(fetched_at: str, ttl_seconds: int) -> bool:
    try:
        fetched = datetime.fromisoformat(fetched_at.replace("Z", "+00:00"))
        return (datetime.now(UTC) - fetched).total_seconds() > ttl_seconds
    except (ValueError, TypeError):
        return True

