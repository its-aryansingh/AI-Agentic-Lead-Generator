/**
 * LeadGenAI extension service worker.
 *
 * Three responsibilities:
 *   1. Bridge auth — read the Supabase session cookie from the web app
 *      origin (chunked-cookie aware), expose `access_token` to the side
 *      panel via chrome.runtime messaging.
 *   2. Poll alerts — fire on chrome.alarms, hit /api/extension/alerts
 *      with the bearer token, raise chrome.notifications for new items,
 *      dedupe by id in chrome.storage.local. (Fallback when VAPID is
 *      not configured.)
 *   3. Web Push (VAPID) — when the backend has VAPID keys, subscribe
 *      the service worker's pushManager and surface 'push' events as
 *      chrome.notifications. Real server-push beats 1-min polling.
 */

// MV3 service workers run in a worker scope. The WebWorker lib gives
// us ServiceWorkerGlobalScope.
declare const self: ServiceWorkerGlobalScope

const API_BASE = "http://localhost:3000"
const POLL_ALARM = "leadgen-poll-alerts"
const POLL_INTERVAL_MIN = 1
const WEB_PUSH_SUBSCRIBED_KEY = "leadgen.webPushSubscribed"
const WEB_PUSH_ATTEMPT_KEY = "leadgen.webPushLastAttemptMs"
const WEB_PUSH_RETRY_MS = 60 * 60 * 1000 // back off an hour on failure
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
  if (request?.action === "registerWebPush") {
    ensureWebPushSubscription().finally(() => sendResponse({ ok: true }))
    return true
  }
  return false
})

// ---- Web Push (VAPID) ----------------------------------------------------

interface VapidKeyResponse {
  configured: boolean
  public_key?: string
  subject?: string
}

/**
 * Convert a base64url-encoded VAPID public key into an ArrayBuffer
 * PushManager.subscribe expects. Returns the underlying ArrayBuffer
 * (not Uint8Array) so newer TS DOM types accept it as BufferSource
 * without the SharedArrayBuffer-union narrowing complaint.
 */
function urlBase64ToBuffer(base64UrlString: string): ArrayBuffer {
  const padding = "=".repeat((4 - (base64UrlString.length % 4)) % 4)
  const base64 = (base64UrlString + padding).replace(/-/g, "+").replace(/_/g, "/")
  const rawData = atob(base64)
  const buf = new ArrayBuffer(rawData.length)
  const view = new Uint8Array(buf)
  for (let i = 0; i < rawData.length; i++) view[i] = rawData.charCodeAt(i)
  return buf
}

/**
 * Subscribe (or re-subscribe) the service worker's pushManager to
 * the backend's VAPID key, then POST the subscription. Idempotent —
 * if we already have a fresh subscription the backend just refreshes
 * `last_seen_at` via the upsert. Backs off for an hour on failure
 * so a misconfigured backend doesn't burn cycles on every tick.
 */
async function ensureWebPushSubscription(): Promise<void> {
  const store = await chrome.storage.local.get([WEB_PUSH_SUBSCRIBED_KEY, WEB_PUSH_ATTEMPT_KEY])
  const subscribed = Boolean(store[WEB_PUSH_SUBSCRIBED_KEY])
  const lastAttempt = typeof store[WEB_PUSH_ATTEMPT_KEY] === "number"
    ? (store[WEB_PUSH_ATTEMPT_KEY] as number)
    : 0
  if (subscribed) return
  if (Date.now() - lastAttempt < WEB_PUSH_RETRY_MS) return

  await chrome.storage.local.set({ [WEB_PUSH_ATTEMPT_KEY]: Date.now() })

  const token = await getAccessToken()
  if (!token) return // can't subscribe without an authenticated user

  let keyResp: VapidKeyResponse
  try {
    const res = await fetch(`${API_BASE}/api/extension/web-push-key`)
    if (!res.ok) return
    keyResp = (await res.json()) as VapidKeyResponse
  } catch {
    return
  }
  if (!keyResp.configured || !keyResp.public_key) return

  let sub: PushSubscription
  try {
    const existing = await self.registration.pushManager.getSubscription()
    sub = existing
      ?? (await self.registration.pushManager.subscribe({
        userVisibleOnly: true,
        applicationServerKey: urlBase64ToBuffer(keyResp.public_key),
      }))
  } catch (err) {
    console.warn("[leadgen] pushManager.subscribe failed", err)
    return
  }

  const subJson = sub.toJSON() as {
    endpoint?: string
    keys?: { p256dh?: string; auth?: string }
  }
  if (!subJson.endpoint || !subJson.keys?.p256dh || !subJson.keys?.auth) return

  try {
    const post = await fetch(`${API_BASE}/api/extension/web-push-subscribe`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${token}` },
      body: JSON.stringify({
        subscription: {
          endpoint: subJson.endpoint,
          keys: { p256dh: subJson.keys.p256dh, auth: subJson.keys.auth },
        },
        platform: "web",
      }),
    })
    if (post.ok) {
      await chrome.storage.local.set({ [WEB_PUSH_SUBSCRIBED_KEY]: true })
    }
  } catch (err) {
    console.warn("[leadgen] web-push-subscribe POST failed", err)
  }
}

// 'push' events arrive when the backend's notifyPush() fans out a web
// push. Payload mirrors the chrome.alarms-driven alert shape so the
// notification rendering is uniform.
self.addEventListener("push", (event) => {
  let title = "LeadGenAI"
  let body = ""
  let alertKind: "hot_reply" | "automation_done" | undefined
  let alertId: string | undefined

  if (event.data) {
    try {
      const payload = event.data.json() as {
        title?: string
        body?: string
        data?: { kind?: string; recipient_id?: string; run_id?: string }
      }
      if (payload.title) title = payload.title
      if (payload.body) body = payload.body
      const k = payload.data?.kind
      if (k === "hot_reply" || k === "automation_done") alertKind = k
      const id = payload.data?.recipient_id ?? payload.data?.run_id
      if (k === "hot_reply" && id) alertId = `reply:${id}`
      else if (k === "automation_done" && id) alertId = `run:${id}`
    } catch {
      body = event.data.text()
    }
  }

  event.waitUntil(
    chrome.notifications.create(alertId ?? `push:${Date.now()}`, {
      type: "basic",
      iconUrl: NOTIFICATION_ICON,
      title,
      message: body || " ",
      priority: alertKind === "hot_reply" ? 2 : 1,
    }) as unknown as Promise<unknown>,
  )
})

// Re-subscribe when the browser invalidates an old subscription.
self.addEventListener("pushsubscriptionchange", (event) => {
  event.waitUntil(
    chrome.storage.local
      .set({ [WEB_PUSH_SUBSCRIBED_KEY]: false })
      .then(() => ensureWebPushSubscription()),
  )
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

chrome.runtime.onInstalled.addListener(() => {
  ensureAlarm()
  void ensureWebPushSubscription()
})
chrome.runtime.onStartup.addListener(() => {
  ensureAlarm()
  void ensureWebPushSubscription()
})

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === POLL_ALARM) {
    pollAlerts()
  }
})
