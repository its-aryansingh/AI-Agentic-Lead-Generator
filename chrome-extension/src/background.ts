/**
 * LeadGenAI extension service worker.
 *
 * Two responsibilities:
 *   1. Bridge auth — read the Supabase session cookie from the web app
 *      origin (chunked-cookie aware), expose `access_token` to the side
 *      panel via chrome.runtime messaging.
 *   2. Poll alerts — fire on chrome.alarms, hit /api/extension/alerts
 *      with the bearer token, raise chrome.notifications for new items,
 *      dedupe by id in chrome.storage.local.
 */

const API_BASE = "http://localhost:3000"
const POLL_ALARM = "leadgen-poll-alerts"
const POLL_INTERVAL_MIN = 1
// Supabase auth cookie pattern. In SSR setups it's
// `sb-<projectRef>-auth-token`, optionally chunked into `.0`, `.1`, ...
// We match the prefix and concatenate suffixes in name-sort order so a
// chunked value reassembles correctly.
const SUPABASE_COOKIE_PREFIX = "sb-"
const SUPABASE_COOKIE_SUFFIX = "-auth-token"

const LAST_POLL_KEY = "leadgen.lastPollTs"
const SEEN_ALERTS_KEY = "leadgen.seenAlertIds"
const MAX_SEEN_IDS = 200

// Notifications need PNG iconUrl; the favicon.svg in /public won't work.
// Inline 1x1 transparent PNG keeps us off a binary commit while still
// satisfying the API contract.
const NOTIFICATION_ICON =
  "data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNkYAAAAAYAAjCB0C8AAAAASUVORK5CYII="

interface ExtensionAlert {
  kind: "hot_reply" | "automation_done"
  id: string
  ts: string
  title: string
  body: string
  meta: Record<string, unknown>
}

interface AlertsResponse {
  alerts: ExtensionAlert[]
  server_time: string
}

// Open side panel on toolbar click.
chrome.sidePanel
  .setPanelBehavior({ openPanelOnActionClick: true })
  .catch((err: unknown) => console.error("[leadgen] setPanelBehavior failed", err))

// ---- Auth cookie → access_token ------------------------------------------

async function getAccessToken(): Promise<string | null> {
  try {
    const cookies = await chrome.cookies.getAll({ url: API_BASE })
    const auth = cookies
      .filter(
        (c) =>
          c.name.startsWith(SUPABASE_COOKIE_PREFIX) &&
          (c.name === pickSingleName(cookies) || c.name.includes(SUPABASE_COOKIE_SUFFIX)),
      )
      .filter((c) => c.name.includes(SUPABASE_COOKIE_SUFFIX))
      .sort((a, b) => a.name.localeCompare(b.name))
    if (auth.length === 0) return null
    const raw = auth.map((c) => c.value).join("")
    return parseSupabaseCookieValue(raw)
  } catch (err) {
    console.warn("[leadgen] getAccessToken failed", err)
    return null
  }
}

function pickSingleName(cookies: chrome.cookies.Cookie[]): string {
  // Prefer the un-chunked `...-auth-token` if present; else any chunked
  // sibling matches the suffix filter above. Returning the un-chunked
  // name as a hint keeps the filter readable.
  const exact = cookies.find(
    (c) => c.name.startsWith(SUPABASE_COOKIE_PREFIX) && c.name.endsWith(SUPABASE_COOKIE_SUFFIX),
  )
  return exact?.name ?? ""
}

export function parseSupabaseCookieValue(raw: string): string | null {
  if (!raw) return null
  let json: string
  if (raw.startsWith("base64-")) {
    try {
      json = atob(raw.slice("base64-".length))
    } catch {
      return null
    }
  } else {
    json = raw
  }
  try {
    const parsed: unknown = JSON.parse(json)
    if (Array.isArray(parsed)) {
      const first = parsed[0]
      if (first && typeof first === "object" && "access_token" in first) {
        const tok = (first as { access_token: unknown }).access_token
        return typeof tok === "string" ? tok : null
      }
      // Legacy shape: positional [access_token, refresh_token, ...]
      return typeof first === "string" ? first : null
    }
    if (parsed && typeof parsed === "object" && "access_token" in parsed) {
      const tok = (parsed as { access_token: unknown }).access_token
      return typeof tok === "string" ? tok : null
    }
    return null
  } catch {
    return null
  }
}

// ---- Message bridge to the side panel ------------------------------------

chrome.runtime.onMessage.addListener((request, _sender, sendResponse) => {
  if (request?.action === "getToken") {
    getAccessToken().then((token) => sendResponse({ token, apiBase: API_BASE }))
    return true // async
  }
  if (request?.action === "getApiBase") {
    sendResponse({ apiBase: API_BASE })
    return false
  }
  if (request?.action === "pollNow") {
    pollAlerts().finally(() => sendResponse({ ok: true }))
    return true
  }
  return false
})

// ---- Alerts polling -------------------------------------------------------

async function pollAlerts(): Promise<void> {
  const token = await getAccessToken()
  if (!token) return // unauthenticated — silent skip

  const store = await chrome.storage.local.get([LAST_POLL_KEY, SEEN_ALERTS_KEY])
  const lastTs = typeof store[LAST_POLL_KEY] === "string" ? (store[LAST_POLL_KEY] as string) : null
  const seenArr = Array.isArray(store[SEEN_ALERTS_KEY]) ? (store[SEEN_ALERTS_KEY] as string[]) : []
  const seen = new Set<string>(seenArr)

  const url = new URL(`${API_BASE}/api/extension/alerts`)
  if (lastTs) url.searchParams.set("since", lastTs)

  let body: AlertsResponse
  try {
    const res = await fetch(url.toString(), {
      headers: { Authorization: `Bearer ${token}` },
    })
    if (!res.ok) return
    body = (await res.json()) as AlertsResponse
  } catch (err) {
    console.warn("[leadgen] poll fetch failed", err)
    return
  }

  for (const alert of body.alerts ?? []) {
    if (seen.has(alert.id)) continue
    try {
      chrome.notifications.create(alert.id, {
        type: "basic",
        iconUrl: NOTIFICATION_ICON,
        title: alert.title,
        message: alert.body,
        priority: alert.kind === "hot_reply" ? 2 : 1,
      })
    } catch (err) {
      console.warn("[leadgen] notification create failed", err)
    }
    seen.add(alert.id)
  }

  const trimmed = Array.from(seen).slice(-MAX_SEEN_IDS)
  await chrome.storage.local.set({
    [LAST_POLL_KEY]: body.server_time,
    [SEEN_ALERTS_KEY]: trimmed,
  })
}

chrome.notifications.onClicked.addListener((notificationId) => {
  let url = `${API_BASE}/app/chat`
  if (notificationId.startsWith("reply:")) {
    url = `${API_BASE}/app/inbox`
  } else if (notificationId.startsWith("run:")) {
    url = `${API_BASE}/app/automations`
  }
  chrome.tabs.create({ url }).catch(() => undefined)
  chrome.notifications.clear(notificationId).catch(() => undefined)
})

// ---- Alarm registration ---------------------------------------------------

function ensureAlarm(): void {
  chrome.alarms.get(POLL_ALARM).then((existing) => {
    if (existing) return
    chrome.alarms.create(POLL_ALARM, {
      periodInMinutes: POLL_INTERVAL_MIN,
      delayInMinutes: 0.1,
    })
  })
}

chrome.runtime.onInstalled.addListener(() => ensureAlarm())
chrome.runtime.onStartup.addListener(() => ensureAlarm())

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    pollAlerts()
  }
})
