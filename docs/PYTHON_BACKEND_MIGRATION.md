# Python Backend Migration Plan

## Goal

Move backend behavior from Next.js API routes to Python Django without breaking the existing product. The safe path is a strangler migration: keep Next.js serving production, run `backend-python/` beside it, then cut over one route group at a time after contract parity checks.

## Current State

The live backend is broad and feature-complete inside the Next.js app:

- Agent and orchestration routes under `app/api/chat`.
- Cron workers under `app/api/cron/*`.
- Exports under `app/api/export/*`.
- Extension/mobile support under `app/api/extension/*`.
- Billing and channel webhooks under `app/api/webhooks/*`.
- Shared backend logic in `lib/agent`, `lib/providers`, `lib/credits`, `lib/cache`, `lib/notifications`, and related modules.

The new Django service starts in `backend-python/` and currently implements:

- `GET /api/health`
- `GET /health`
- `GET /api/extension/me`
- `GET /api/migration/routes`
- Django URL reservations for the rest of the current `app/api/*` surface, returning `501 route_not_migrated` until parity is implemented.

## Cutover Order

### Phase 1: Infrastructure and Read-Only Identity

- Keep Next.js production behavior unchanged.
- Deploy the Python service privately.
- Verify `/api/health` response parity.
- Verify bearer-token auth with `/api/extension/me`.
- Add uptime checks against Python only after Supabase env is configured.

### Phase 2: Low-Risk Read/Write Endpoints

- Move extension helpers that do not depend on AI SDK streaming:
- `/api/extension/alerts`
- `/api/extension/replies/{id}/handle`
- `/api/extension/web-push-key`
- `/api/extension/web-push-subscribe`
- `/api/extension/push-register`
- `/api/prospects/{id}`
- `/api/domain-check`

### Phase 3: Webhooks and Workers

- Move webhook routes after signature verification has test parity:
- `/api/webhooks/stripe`
- `/api/webhooks/razorpay`
- `/api/webhooks/whatsapp`

- Move cron routes after idempotency checks:
- `/api/cron/send-due`
- `/api/cron/detect-replies`
- `/api/cron/poll-intent`
- `/api/cron/advance-sequences`
- `/api/cron/run-automations`

### Phase 4: Exports

- Move `/api/export/csv` first because it is deterministic.
- Move `/api/export/sheets` only after Google OAuth token handling is verified.

### Phase 5: Agent Tools and Providers

- Port `lib/providers/*` to Python provider modules.
- Port pure helpers first: compliance, CSV parsing, warm-up caps, reply classification contracts.
- Preserve deterministic mock fallbacks for every provider.
- Keep cost-control cache behavior equivalent to `getOrSetCache()`.

### Phase 6: Chat Last

Move `/api/chat` last. It is the highest-risk route because the frontend currently expects Vercel AI SDK streaming semantics and tool-call card events.

Do not cut over chat until Python can provide one of these:

- The same UI-message stream contract the current chat client consumes.
- A Next.js compatibility proxy that translates Python agent events to AI SDK UI-message chunks.

## Non-Negotiables

- Never expose `SUPABASE_SERVICE_ROLE_KEY` to browser code.
- Keep RLS ownership checks even when using the service-role key.
- Preserve mock fallbacks when provider keys are absent.
- Do not globally repoint `/api/*` to Python.
- Every cutover needs a rollback path to the existing Next.js route.
- Contract tests should compare current Next.js JSON shape against Python JSON shape before traffic moves.

## Local Commands

```powershell
cd backend-python
python -m venv .venv
.\.venv\Scripts\Activate.ps1
pip install -r requirements.txt
python -m unittest discover
python manage.py runserver 8000
```

## Deployment Shape

Recommended deployment is a separate service:

- Next.js remains on Vercel.
- Django runs on Render, Fly.io, Railway, or a container service.
- Vercel rewrites or explicit frontend URLs cut over individual endpoints.

Example cutover, not enabled by this change:

```json
{
  "rewrites": [
    { "source": "/api/health", "destination": "https://python-api.example.com/api/health" }
  ]
}
```

Use one rewrite at a time only after parity checks pass.
