from __future__ import annotations

from datetime import UTC, datetime
from time import monotonic
from typing import Any, Callable

from django.http import HttpRequest, HttpResponse, JsonResponse
from django.views.decorators.csrf import csrf_exempt

from leadgen_backend import __version__
from leadgen_backend.auth import parse_bearer_token
from leadgen_backend.config import (
    STARTED_AT,
    get_settings,
    provider_matrix,
    read_crons,
    read_schema_version,
)
from leadgen_backend.route_inventory import NEXT_API_ROUTES, PYTHON_ROUTES
from leadgen_backend.supabase_rest import SupabaseRest
from leadgen_backend.validators import (
    VALID_STAGES,
    is_valid_push_token,
    is_valid_uuid,
    is_valid_web_push_subscription,
    is_vapid_configured,
    parse_json_body,
)
from leadgen_backend.domain_auth import check_domain


def json_options() -> JsonResponse:
    return JsonResponse({}, status=204)


@csrf_exempt
async def health(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return json_options()
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    settings = get_settings()
    db = await SupabaseRest(settings).ping_users()
    body: dict[str, Any] = {
        "ok": db.ok,
        "service": "leadgenai",
        "version": f"django-{__version__}",
        "timestamp": datetime.now(UTC).isoformat(),
        "uptime_seconds": round(monotonic() - STARTED_AT),
        "providers": provider_matrix(settings),
        "db": {
            "ok": db.ok,
            "latency_ms": db.latency_ms,
            **({"error": db.error} if db.error else {}),
        },
        "schema_version": read_schema_version(),
        "crons": read_crons(),
    }
    return JsonResponse(body, status=200 if db.ok else 503)


@csrf_exempt
async def extension_me(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return json_options()
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    token = parse_bearer_token(request.headers.get("Authorization"))
    supabase = SupabaseRest(get_settings())
    auth = await supabase.user_from_token(token)
    if not auth.user:
        return JsonResponse(
            {"error": "unauthorized", "reason": auth.reason},
            status=401,
        )

    profile = await supabase.get_profile(auth.user.id)
    profile = profile or {}
    return JsonResponse(
        {
            "user": {"id": auth.user.id, "email": auth.user.email},
            "plan": profile.get("plan", "free"),
            "credits_remaining": profile.get("credits_remaining", 0),
            "notifications": {
                "whatsapp_enabled": bool(profile.get("notify_whatsapp")),
                "whatsapp_number": profile.get("whatsapp_number"),
            },
        }
    )


@csrf_exempt
def route_inventory(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return json_options()
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    return JsonResponse(
        {
            "framework": "django",
            "strategy": "django-backend-route-by-route-cutover",
            "next_api_routes": NEXT_API_ROUTES,
            "python_routes": PYTHON_ROUTES,
            "cutover_gate": [
                "contract response matches current Next.js route",
                "mock fallback works without provider keys",
                "service-role key is only used server-side",
                "route has rollback path to Next.js implementation",
            ],
        }
    )


def pending_route(route_name: str) -> Callable[..., JsonResponse]:
    @csrf_exempt
    def view(request: HttpRequest, **kwargs: Any) -> JsonResponse:
        if request.method == "OPTIONS":
            return json_options()
        return JsonResponse(
            {
                "error": "route_not_migrated",
                "route": route_name,
                "framework": "django",
                "detail": "Django URL is reserved for this migrated backend, but behavior still lives in the Next.js route until parity is implemented.",
                "params": kwargs,
            },
            status=501,
        )

    return view


@csrf_exempt
async def web_push_key(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return json_options()
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)
        
    if not is_vapid_configured():
        return JsonResponse({"configured": False})
        
    settings = get_settings()
    return JsonResponse({
        "configured": True,
        "public_key": settings.vapid_public_key,
        "subject": settings.vapid_subject,
    })


@csrf_exempt
async def push_register(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return json_options()
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    token = parse_bearer_token(request.headers.get("Authorization"))
    supabase = SupabaseRest(get_settings())
    auth = await supabase.user_from_token(token)
    if not auth.user:
        return JsonResponse({"error": "unauthorized", "reason": auth.reason}, status=401)

    parsed, err = parse_json_body(request.body)
    if err or not parsed:
        return JsonResponse({"error": err or "invalid JSON"}, status=400)
        
    push_token = parsed.get("token")
    provider = parsed.get("provider")
    if not isinstance(push_token, str) or not isinstance(provider, str) or not is_valid_push_token(push_token, provider):
        return JsonResponse({"error": "invalid push token format for provider"}, status=400)

    platform = parsed.get("platform") if isinstance(parsed.get("platform"), str) else None
    device_id = parsed.get("device_id") if isinstance(parsed.get("device_id"), str) else None

    result = await supabase.upsert_push_token(
        user_id=auth.user.id,
        token=push_token,
        provider=provider,
        platform=platform,
        device_id=device_id,
    )
    if not result.ok:
        return JsonResponse({"error": result.error}, status=500)
        
    return JsonResponse({"ok": True, "id": result.id, "created": result.created})


@csrf_exempt
async def web_push_subscribe(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return json_options()
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    token = parse_bearer_token(request.headers.get("Authorization"))
    supabase = SupabaseRest(get_settings())
    auth = await supabase.user_from_token(token)
    if not auth.user:
        return JsonResponse({"error": "unauthorized", "reason": auth.reason}, status=401)

    parsed, err = parse_json_body(request.body)
    if err or not parsed:
        return JsonResponse({"error": err or "invalid JSON"}, status=400)

    sub = parsed.get("subscription")
    if not isinstance(sub, dict) or not is_valid_web_push_subscription(sub):
        return JsonResponse({"error": "invalid subscription shape"}, status=400)

    import json
    token_str = json.dumps({
        "endpoint": sub["endpoint"],
        "keys": sub["keys"],
    })
    
    platform = parsed.get("platform") if isinstance(parsed.get("platform"), str) else None
    device_id = parsed.get("device_id") if isinstance(parsed.get("device_id"), str) else None

    result = await supabase.upsert_push_token(
        user_id=auth.user.id,
        token=token_str,
        provider="web",
        platform=platform,
        device_id=device_id,
    )
    if not result.ok:
        return JsonResponse({"error": result.error}, status=500)
        
    return JsonResponse({"ok": True, "id": result.id, "created": result.created})


@csrf_exempt
async def reply_handle(request: HttpRequest, reply_id: str) -> JsonResponse:
    if request.method == "OPTIONS":
        return json_options()
    if request.method != "POST":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    token = parse_bearer_token(request.headers.get("Authorization"))
    supabase = SupabaseRest(get_settings())
    auth = await supabase.user_from_token(token)
    if not auth.user:
        return JsonResponse({"error": "unauthorized", "reason": auth.reason}, status=401)

    if not is_valid_uuid(reply_id):
        return JsonResponse({"error": "invalid reply id"}, status=400)

    result = await supabase.handle_reply(auth.user.id, reply_id)
    if not result.ok:
        return JsonResponse({"error": result.error}, status=result.status)
        
    return JsonResponse({"ok": True, "id": result.data.get("id") if result.data else None, "handled": result.data.get("handled") if result.data else False})


@csrf_exempt
async def prospect_update(request: HttpRequest, prospect_id: str) -> JsonResponse:
    if request.method == "OPTIONS":
        return json_options()
    if request.method != "PATCH":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    token = parse_bearer_token(request.headers.get("Authorization"))
    supabase = SupabaseRest(get_settings())
    auth = await supabase.user_from_token(token)
    if not auth.user:
        return JsonResponse({"error": "unauthorized", "reason": auth.reason}, status=401)

    if not is_valid_uuid(prospect_id):
        return JsonResponse({"error": "Invalid prospect id"}, status=400)

    parsed, err = parse_json_body(request.body)
    if err or not parsed:
        return JsonResponse({"error": err or "Invalid JSON"}, status=400)

    stage = parsed.get("stage")
    if stage not in VALID_STAGES:
        return JsonResponse({"error": "invalid stage"}, status=400)

    result = await supabase.update_prospect_stage(auth.user.id, prospect_id, stage)
    if not result.ok:
        return JsonResponse({"error": result.error}, status=result.status)
        
    return JsonResponse({"id": result.data.get("id") if result.data else None, "stage": result.data.get("stage") if result.data else None})


@csrf_exempt
async def extension_alerts(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return json_options()
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    token = parse_bearer_token(request.headers.get("Authorization"))
    supabase = SupabaseRest(get_settings())
    auth = await supabase.user_from_token(token)
    if not auth.user:
        return JsonResponse({"error": "unauthorized", "reason": auth.reason}, status=401)

    since = request.GET.get("since")
    
    alerts = await supabase.get_alerts(auth.user.id, since)
    return JsonResponse(alerts)


@csrf_exempt
async def domain_check(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS":
        return json_options()
    if request.method != "GET":
        return JsonResponse({"error": "method_not_allowed"}, status=405)

    token = parse_bearer_token(request.headers.get("Authorization"))
    supabase = SupabaseRest(get_settings())
    auth = await supabase.user_from_token(token)
    if not auth.user:
        return JsonResponse({"error": "unauthorized", "reason": auth.reason}, status=401)

    domain = request.GET.get("domain", "").strip().lower()
    if not domain:
        return JsonResponse({"error": "invalid domain", "domain": domain}, status=400)

    ttl_seconds = 24 * 60 * 60
    
    async def fetch_fn():
        return await check_domain(domain)
        
    report = await supabase.get_or_set_cache(
        key=f"domain-auth:{domain}",
        ttl_seconds=ttl_seconds,
        fetch_fn=fetch_fn
    )
    
    return JsonResponse(report)


@csrf_exempt
async def webhook_stripe(request: HttpRequest) -> HttpResponse:
    if request.method == "OPTIONS":
        return json_options()
    if request.method != "POST":
        return HttpResponse("method_not_allowed", status=405)

    signature = request.headers.get("stripe-signature")
    if not signature:
        return HttpResponse("Missing signature", status=400)

    settings = get_settings()
    if not settings.stripe_secret_key or not settings.stripe_webhook_secret:
        return HttpResponse("Stripe not configured", status=500)

    import stripe
    stripe.api_key = settings.stripe_secret_key

    try:
        event = stripe.Webhook.construct_event(
            request.body, signature, settings.stripe_webhook_secret
        )
    except Exception as e:
        return HttpResponse(f"Webhook error: {e}", status=400)

    if event["type"] == "checkout.session.completed":
        session = event["data"]["object"]
        metadata = session.get("metadata", {})
        plan = metadata.get("plan")
        user_id = metadata.get("userId")
        
        if plan and user_id:
            from leadgen_backend.webhooks import PLANS
            plan_info = PLANS.get(plan)
            if plan_info and plan != "free":
                supabase = SupabaseRest(settings)
                await supabase.upgrade_user_plan(
                    user_id=user_id,
                    plan=plan,
                    idempotency_key=event["id"],
                    provider="stripe",
                    credits_to_add=plan_info["credits"]
                )

    return HttpResponse("Webhook processed", status=200)


@csrf_exempt
async def webhook_razorpay(request: HttpRequest) -> HttpResponse:
    if request.method == "OPTIONS":
        return json_options()
    if request.method != "POST":
        return HttpResponse("method_not_allowed", status=405)

    signature = request.headers.get("x-razorpay-signature")
    if not signature:
        return HttpResponse("Missing signature", status=400)

    settings = get_settings()
    from leadgen_backend.webhooks import verify_razorpay_signature, PLANS
    if not verify_razorpay_signature(request.body, signature, settings.razorpay_webhook_secret or ""):
        return HttpResponse("Invalid signature", status=400)

    import json
    try:
        event = json.loads(request.body)
    except json.JSONDecodeError:
        return HttpResponse("Invalid JSON", status=400)

    event_type = event.get("event")
    event_id = event.get("id")
    supabase = SupabaseRest(settings)

    if event_type == "payment.captured":
        payment = event.get("payload", {}).get("payment", {}).get("entity", {})
        notes = payment.get("notes", {})
        plan = notes.get("plan")
        user_id = notes.get("userId")
        
        if plan and user_id:
            plan_info = PLANS.get(plan)
            if plan_info and plan != "free":
                idempotency_key = event_id or payment.get("id")
                await supabase.upgrade_user_plan(
                    user_id=user_id,
                    plan=plan,
                    idempotency_key=idempotency_key,
                    provider="razorpay",
                    credits_to_add=plan_info["credits"]
                )
    elif event_type == "subscription.charged":
        sub = event.get("payload", {}).get("subscription", {}).get("entity", {})
        notes = sub.get("notes", {})
        plan = notes.get("plan")
        user_id = notes.get("userId")
        if plan and user_id:
            plan_info = PLANS.get(plan)
            if plan_info and plan != "free":
                await supabase.upgrade_user_plan(
                    user_id=user_id,
                    plan=plan,
                    idempotency_key=event_id,
                    provider="razorpay",
                    credits_to_add=plan_info["credits"]
                )
        if sub.get("id"):
            await supabase.set_subscription_status(sub["id"], "active")
    elif event_type in ("subscription.activated", "subscription.halted", "subscription.cancelled", "subscription.completed"):
        sub = event.get("payload", {}).get("subscription", {}).get("entity", {})
        if sub.get("id"):
            status = sub.get("status") or event_type.split(".")[1]
            await supabase.set_subscription_status(sub["id"], status)

    return HttpResponse("Webhook processed", status=200)


@csrf_exempt
async def webhook_whatsapp(request: HttpRequest) -> HttpResponse:
    if request.method == "OPTIONS":
        return json_options()
        
    settings = get_settings()
    
    if request.method == "GET":
        mode = request.GET.get("hub.mode")
        token = request.GET.get("hub.verify_token")
        challenge = request.GET.get("hub.challenge")
        
        if mode == "subscribe" and settings.whatsapp_verify_token and token == settings.whatsapp_verify_token and challenge:
            return HttpResponse(challenge, status=200)
        return HttpResponse("forbidden", status=403)
        
    if request.method != "POST":
        return HttpResponse("method_not_allowed", status=405)

    header_flat = request.headers.get("x-webhook-signature")
    header_hub = request.headers.get("x-hub-signature-256")
    
    from leadgen_backend.webhooks import verify_whatsapp_signature, normalize_whatsapp_payload
    if not verify_whatsapp_signature(request.body, header_flat, header_hub, settings.whatsapp_webhook_secret or ""):
        return HttpResponse("Invalid signature", status=401)

    import json
    try:
        payload = json.loads(request.body)
    except json.JSONDecodeError:
        return HttpResponse("Invalid JSON", status=400)

    normalized = normalize_whatsapp_payload(payload)
    supabase = SupabaseRest(settings)
    
    stats = await supabase.handle_whatsapp_webhook(
        messages=normalized["messages"],
        statuses=normalized["statuses"]
    )
    
    return JsonResponse(stats)


def _check_cron_auth(request: HttpRequest) -> bool:
    auth = request.headers.get("Authorization", "").replace("Bearer ", "").replace("bearer ", "")
    import os
    secret = os.getenv("CRON_SECRET")
    return bool(secret and auth == secret)


@csrf_exempt
async def cron_send_due(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS": return json_options()
    if request.method not in ("GET", "POST"): return JsonResponse({"error": "method_not_allowed"}, status=405)
    if not _check_cron_auth(request): return JsonResponse({"error": "Forbidden"}, status=403)
    
    from leadgen_backend.cron import send_due
    res = await send_due(get_settings(), SupabaseRest(get_settings()))
    return JsonResponse(res)

@csrf_exempt
async def cron_detect_replies(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS": return json_options()
    if request.method not in ("GET", "POST"): return JsonResponse({"error": "method_not_allowed"}, status=405)
    if not _check_cron_auth(request): return JsonResponse({"error": "Forbidden"}, status=403)
    
    from leadgen_backend.cron import detect_replies
    res = await detect_replies(get_settings(), SupabaseRest(get_settings()))
    return JsonResponse(res)

@csrf_exempt
async def cron_poll_intent(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS": return json_options()
    if request.method not in ("GET", "POST"): return JsonResponse({"error": "method_not_allowed"}, status=405)
    if not _check_cron_auth(request): return JsonResponse({"error": "Forbidden"}, status=403)
    
    from leadgen_backend.cron import poll_intent
    res = await poll_intent(get_settings(), SupabaseRest(get_settings()))
    return JsonResponse(res)

@csrf_exempt
async def cron_advance_sequences(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS": return json_options()
    if request.method not in ("GET", "POST"): return JsonResponse({"error": "method_not_allowed"}, status=405)
    if not _check_cron_auth(request): return JsonResponse({"error": "Forbidden"}, status=403)
    
    from leadgen_backend.cron import advance_sequences
    res = await advance_sequences(get_settings(), SupabaseRest(get_settings()))
    return JsonResponse(res)

@csrf_exempt
async def cron_run_automations(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS": return json_options()
    if request.method not in ("GET", "POST"): return JsonResponse({"error": "method_not_allowed"}, status=405)
    if not _check_cron_auth(request): return JsonResponse({"error": "Forbidden"}, status=403)
    
    from leadgen_backend.cron import run_automations
    res = await run_automations(get_settings(), SupabaseRest(get_settings()))
    return JsonResponse(res)

@csrf_exempt
async def export_csv(request: HttpRequest) -> HttpResponse:
    if request.method == "OPTIONS": return json_options()
    if request.method != "GET": return JsonResponse({"error": "method_not_allowed"}, status=405)

    token = parse_bearer_token(request.headers.get("Authorization"))
    supabase = SupabaseRest(get_settings())
    auth = await supabase.user_from_token(token)
    if not auth.user:
        return HttpResponse("Unauthorized", status=401)

    job_id = request.GET.get("jobId")
    if not job_id:
        return HttpResponse("jobId required", status=400)

    prospects = await supabase._get("prospects", {
        "job_id": f"eq.{job_id}",
        "select": "input_name,input_company,input_linkedin_url,email,email_confidence,research_summary,email_subject,email_body,talking_points"
    }, headers={"Authorization": f"Bearer {token}"})
    
    if prospects is None:
        return HttpResponse("Error fetching prospects", status=400)

    from leadgen_backend.export_csv import rows_to_csv
    csv_str = rows_to_csv(prospects)
    
    response = HttpResponse(csv_str, content_type="text/csv; charset=utf-8")
    response["Content-Disposition"] = f'attachment; filename="leadgenai-{job_id}.csv"'
    return response

@csrf_exempt
async def export_sheets(request: HttpRequest) -> JsonResponse:
    if request.method == "OPTIONS": return json_options()
    if request.method != "POST": return JsonResponse({"error": "method_not_allowed"}, status=405)

    token = parse_bearer_token(request.headers.get("Authorization"))
    supabase = SupabaseRest(get_settings())
    auth = await supabase.user_from_token(token)
    if not auth.user:
        return JsonResponse({"error": "Unauthorized"}, status=401)

    parsed, err = parse_json_body(request.body)
    if err or not parsed:
        return JsonResponse({"error": err or "Invalid JSON"}, status=400)

    job_id = parsed.get("jobId")
    if not job_id:
        return JsonResponse({"error": "jobId required"}, status=400)

    prospects = await supabase._get("prospects", {
        "job_id": f"eq.{job_id}",
        "select": "input_name,input_company,input_linkedin_url,email,email_confidence,research_summary,email_subject,email_body,talking_points"
    }, headers={"Authorization": f"Bearer {token}"})

    if prospects is None:
        return JsonResponse({"error": "Error fetching prospects"}, status=400)

    user_row = await supabase._get("users", {"id": f"eq.{auth.user.id}", "select": "google_refresh_token"})
    refresh_token = user_row[0].get("google_refresh_token") if user_row else None

    from leadgen_backend.export_sheets import export_to_sheet
    title = f"LeadGenAI — Job {job_id[:8]} — {datetime.now(UTC).strftime('%Y-%m-%d %H:%M:%S')}"
    sheet = await export_to_sheet(refresh_token, title, prospects)

    await supabase._patch("jobs", {"id": f"eq.{job_id}", "user_id": f"eq.{auth.user.id}"}, {"sheet_url": sheet["url"]})

    return JsonResponse({"url": sheet["url"], "mock": sheet["mock"]})
