# LeadGenAI Chrome Extension

Side-panel copilot for the LeadGenAI web app. Talks to the same `/api/chat`
the main app uses, but authenticates via bearer token (cookies don't cross
the `chrome-extension://[id]` origin) and surfaces alerts as native
Chrome notifications.

## Architecture

```
LeadGenAI web app (localhost:3000)
        │
        │ Supabase auth cookie (read by background.ts)
        ▼
chrome-extension/src/background.ts (service worker)
        │
        ├── chrome.alarms tick (1 min) ──► fetch /api/extension/alerts (bearer)
        │                                       │
        │                                       └─► chrome.notifications.create
        │
        └── chrome.runtime onMessage 'getToken' ──► returns { token, apiBase }
                                                            │
                                                            ▼
                                          chrome-extension/src/App.tsx (side panel)
                                          ──► fetch /api/chat (bearer + stream)
                                          ──► fetch /api/extension/me (header chip)
                                          ──► fetch /api/extension/alerts (bell badge)
```

## Backend endpoints used

| Endpoint | Method | Purpose |
|---|---|---|
| `/api/chat` | POST | Orchestrator chat (bearer auth) |
| `/api/extension/me` | GET | User + plan + credit chip in header |
| `/api/extension/alerts` | GET | Bell badge + notification feed; `?since=` cursor |
| `/api/extension/replies/[id]/handle` | POST | Mark a reply alert handled |

## Development

```bash
cd chrome-extension
npm install
npm run dev    # vite dev with HMR — open chrome://extensions and "Load unpacked" → dist/
npm run build  # tsc -b && vite build → dist/
```

The web app must be running at `http://localhost:3000` and the user must
be signed in there before the side panel can fetch a token.

## Permissions

| Permission | Reason |
|---|---|
| `cookies` | Read the Supabase auth cookie to extract `access_token` |
| `alarms` | Periodic poll of `/api/extension/alerts` |
| `notifications` | Surface hot replies + automation completions |
| `sidePanel` | Open the chat UI in Chrome's side panel |
| `storage` | Dedupe seen alert ids; remember the `since` cursor |
| `tabs` | Open the relevant app page on notification click |
| `activeTab` | Read the current tab's title/URL for chat context |

## Token bridge

`background.ts` reads the cookie value for any `sb-*-auth-token` (or its
chunked siblings `.0`, `.1`, …) from the web app origin, concatenates the
chunks in name-sort order, strips the `base64-` prefix if present, and
parses the JSON to extract `access_token`. The token is requested fresh
on every panel open and every alarm tick — no long-term cache — so a
user signing out invalidates the side panel immediately.

## Production URL

`background.ts` currently points at `http://localhost:3000`. For
production, change `API_BASE` (and the corresponding entry in
`manifest.json` `host_permissions`) to the deployed Vercel URL.
