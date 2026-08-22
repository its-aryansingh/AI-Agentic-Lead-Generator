# LeadGenAI — Python Backend

Django + ASGI backend that replaces the Next.js `app/api/` layer. Serves all business logic; the Next.js frontend renders UI pages only.

## Quick Start

```bash
# 1. Install dependencies
cd backend-python
python -m venv .venv
# Windows
.venv\Scripts\activate
# macOS/Linux
source .venv/bin/activate

pip install -r requirements.txt

# 2. Configure environment
cp .env.example .env
# Edit .env — minimum required for auth:
#   NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
#   NEXT_PUBLIC_SUPABASE_ANON_KEY=
#   SUPABASE_SERVICE_ROLE_KEY=

# 3. Run development server (ASGI with hot-reload)
uvicorn leadgen_backend.asgi:application --host 0.0.0.0 --port 8000 --reload
```

The server starts at **http://localhost:8000**

## Mock Mode

All provider keys have deterministic mock fallbacks. The backend runs end-to-end without any API keys **except Supabase** (required for auth). Real outputs show `"using_mock_data": true` in responses.

## API Routes

| Method | Route | Description |
|--------|-------|-------------|
| POST | `/api/chat` | **Core** — SSE streaming agent (Claude + tool calls) |
| GET | `/api/auth/callback` | Google OAuth exchange + users upsert |
| GET | `/api/mailbox/connect` | Initiate Gmail OAuth for mailbox connection |
| GET | `/api/mailbox/callback` | Gmail OAuth callback — store refresh token |
| GET | `/api/health` | Health check with provider matrix |
| GET | `/api/migration/routes` | Route inventory (migration status) |
| GET | `/api/extension/me` | Extension: current user + credits |
| GET | `/api/extension/alerts` | Extension: hot replies + automation alerts |
| POST | `/api/extension/push-register` | Register Expo/Web push token |
| GET | `/api/extension/web-push-key` | VAPID public key for web push |
| POST | `/api/extension/web-push-subscribe` | Web push subscription |
| PATCH | `/api/extension/replies/<id>/handle` | Mark reply as handled |
| POST | `/api/extension/replies/<id>/draft-response` | Draft reply response |
| PATCH | `/api/prospects/<id>` | Update prospect stage |
| GET | `/api/domain-check` | SMTP domain MX/SPF/DKIM check |
| GET | `/api/export/csv` | CSV export for a job |
| POST | `/api/export/sheets` | Export job to Google Sheets |
| POST | `/api/cron/send-due` | Send due campaign emails |
| POST | `/api/cron/detect-replies` | Poll Gmail for inbound replies |
| POST | `/api/cron/poll-intent` | Classify pending replies |
| POST | `/api/cron/advance-sequences` | Advance sequence steps |
| POST | `/api/cron/run-automations` | Run pending automations |
| POST | `/api/webhooks/stripe` | Stripe billing webhook |
| POST | `/api/webhooks/razorpay` | Razorpay billing webhook |
| GET/POST | `/api/webhooks/whatsapp` | WhatsApp Cloud API webhook |

## Agent Chat Endpoint

`POST /api/chat` streams Server-Sent Events (SSE) in Vercel AI SDK–compatible format.

**Request:**
```json
{
  "sessionId": "uuid-or-null",
  "messages": [
    {"role": "user", "content": "find me 10 heads of marketing at Indian fintech startups"}
  ]
}
```

**Authentication:** `Authorization: Bearer <supabase-jwt>` (Chrome extension) or Supabase session cookie (browser).

**Response:** `text/event-stream` with `data: {...}\n\n` events:
- `{"type": "text", "text": "..."}` — streamed text chunks
- `{"type": "tool_call", "id": "...", "name": "web_search", "input": {...}}` — tool invocation
- `{"type": "tool_result", "id": "...", "name": "web_search", "result": {...}}` — tool result
- `data: [DONE]` — stream complete

## Agent Tools

| Tool | Description |
|------|-------------|
| `web_search` | Discover prospects via Brave Search |
| `public_source_search` | Vertical discovery (GitHub/ProductHunt/HN) |
| `enrich_prospect` | Single-person deep research + cold email |
| `clarify_question` | Ask user a clarifying question |
| `add_named_prospects` | Stage user-provided names for bulk enrichment |
| `start_bulk_job` | Bulk enrich → Google Sheet + CSV |
| `launch_campaign` | Send emails from connected Gmail |
| `push_to_crm` | Push enriched prospects to HubSpot or Zoho |
| `draft_reply` | Draft reply to a classified hot reply |

## Docker

```bash
# Local dev (with hot-reload)
docker-compose up

# Production build
docker build -t leadgenai-backend .
docker run -p 8000:8000 --env-file .env leadgenai-backend
```

## Project Structure

```
backend-python/
├── leadgen_backend/
│   ├── agent/           ← Chat agent (system prompt, tool defs, tool handlers, SSE view)
│   │   ├── __init__.py
│   │   ├── system_prompt.py
│   │   ├── tool_definitions.py
│   │   ├── tool_handlers.py
│   │   └── chat_view.py
│   ├── api/             ← Django views + URLs
│   │   ├── views.py
│   │   ├── auth_views.py
│   │   └── urls.py
│   ├── providers/       ← External service wrappers (all mock-safe)
│   │   ├── anthropic_client.py
│   │   ├── brave_search.py
│   │   ├── gmail.py
│   │   ├── github.py
│   │   ├── hn_algolia.py
│   │   ├── producthunt.py
│   │   ├── hubspot.py
│   │   ├── zoho.py
│   │   ├── whatsapp.py
│   │   ├── notifications.py
│   │   └── reply_classifier.py
│   ├── supabase_rest.py ← All DB operations via Supabase REST API
│   ├── config.py        ← Settings from environment variables
│   ├── email_compliance.py
│   ├── email_warmup_core.py
│   ├── sequence_utils.py
│   ├── cron.py
│   ├── webhooks.py
│   ├── export_csv.py
│   ├── export_sheets.py
│   ├── settings.py
│   ├── asgi.py
│   └── urls.py
├── requirements.txt
├── Dockerfile
├── docker-compose.yml
└── .env.example
```

## Environment Variables

See [`.env.example`](.env.example) for full list. Minimum for auth:

```env
NEXT_PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
NEXT_PUBLIC_SUPABASE_ANON_KEY=your-anon-key
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key  # Never expose to browser
```

## Connecting the Next.js Frontend

The Next.js frontend can call this backend by setting the API base URL. In `next.config.ts`:

```ts
// Proxy all /api/* calls to the Python backend in development
async rewrites() {
  return [
    {
      source: "/api/:path*",
      destination: "http://localhost:8000/api/:path*",
    },
  ]
}
```

Or set `NEXT_PUBLIC_API_URL=http://localhost:8000` and update the fetch calls.
