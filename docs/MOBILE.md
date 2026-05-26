# MOBILE.md — LeadGenAI Mobile App Scope

**Status:** Phase 6 spec. Not implemented; this is the design doc that
should precede any RN/Expo work.
**Last updated:** 2026-05-26
**Owner:** Claude CLI (backend lane), TBD (mobile lane)

---

## Why a mobile app

LeadGenAI's two highest-frequency mobile use cases are not chat:

1. **Hot-reply triage.** A prospect replies; the rep wants to draft a
   response from their phone in under 60 seconds. Today the only paths
   are email (slow, no context) or the desktop web app (not at hand).
2. **Automation-completion review.** A scheduled automation finishes;
   the rep wants a single-screen summary ("found 23 fintech CMOs,
   drafted outreach, 14 ready to send") and a tap-to-approve.

Cold prospecting (web_search + bulk_job + sheet export) belongs on
desktop and is explicitly out of scope here.

## Architecture decision: React Native (Expo) vs PWA

We choose **Expo / React Native** with a **shared API surface** to the
existing Next.js backend.

| Factor | RN/Expo | PWA (Capacitor wrap of Next) |
|---|---|---|
| Push notifications (foreground + background) | First-class (FCM/APNs via Expo) | Limited — iOS PWA push only since iOS 16.4, still flaky |
| Code reuse with web app | Minimal (different runtime) | Heavy (whole React tree) |
| App-store distribution | Yes (TestFlight, Play console) | Web install only |
| Native gestures, share-sheet | Yes | Limited |
| Time to MVP | ~3 weeks | ~1 week |

The decision swings on push notifications. The two primary use cases
both depend on reliable background delivery — without that the mobile
app is just a worse browser. RN/Expo's push story is mature; PWA's is
not, especially on iOS.

## API surface (no new backend needed)

Mobile re-uses what the Chrome extension already proved out:

| Endpoint | Method | Use |
|---|---|---|
| `/api/chat` | POST | Bearer-authed streaming chat |
| `/api/extension/me` | GET | User + plan + credits chip |
| `/api/extension/alerts?since=` | GET | Pull alert feed for the inbox tab |
| `/api/extension/replies/[id]/handle` | POST | Dismiss a hot-reply alert |
| `/api/prospects/[id]` | PATCH | Update pipeline stage from a swipe |
| `/api/extension/push-register` | POST | (NEW) register an Expo push token |
| `/api/extension/push-fire` | POST | (NEW, internal) backend fires a push when an alert is created |

The two NEW endpoints replace polling with server-pushed notifications.
They're tiny: `push-register` stores `{user_id, expo_token, device_id}`
in a new `push_tokens` table; `push-fire` is called from existing
hot-reply / automation-completion paths and forwards to Expo's push
API.

## Auth flow

Identical to the Chrome extension's bearer flow:

1. Mobile app opens an in-app browser to `/login` (Google OAuth).
2. After redirect, the app receives the Supabase session via deep link
   (`leadgenai://auth?token=…`).
3. Token cached in `expo-secure-store`; refreshed by Supabase's refresh
   flow.
4. Every backend call carries `Authorization: Bearer <access_token>`.

No new auth code on the backend — the bearer middleware shipped in
`lib/api-auth.ts` already handles this.

## Screens (MVP cut)

```
┌────────────────┐
│  Inbox         │ ← hot replies; swipe-right to handle, tap to draft reply via /api/chat
├────────────────┤
│  Automations   │ ← list of automations, last run summary, tap → details
├────────────────┤
│  Chat          │ ← same orchestrator as web; bare-bones (text only, no tool cards)
├────────────────┤
│  Profile       │ ← plan, credits, sign out
└────────────────┘
```

Out of MVP: pipeline kanban, analytics charts, sequence builder, bulk
job dashboard. Those are desktop-first.

## Push notifications

- Expo Notifications client → register device → POST
  `/api/extension/push-register` with `{ expo_push_token, platform }`.
- Backend pushes via Expo's HTTP/2 push API:
  `POST https://exp.host/--/api/v2/push/send` with the user's tokens
  whenever a `reply_classifications.needs_human=true` row is INSERTed
  or an `automation_runs.status` transitions to `completed`/`failed`.
- Notification payload mirrors the Chrome extension's alert shape so
  the two surfaces stay in sync.

## Schema delta

```sql
create table if not exists public.push_tokens (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  expo_token   text not null unique,
  platform     text check (platform in ('ios','android')),
  device_id    text,
  created_at   timestamptz not null default now(),
  last_seen_at timestamptz not null default now()
);
create index if not exists push_tokens_user_idx on public.push_tokens(user_id);
```

RLS: user owns rows. Service role bypasses for sending.

## Out of scope (Phase 6 explicitly defers)

- LinkedIn / Twitter / Sales Navigator integrations (the desktop
  extension covers in-tab capture; mobile is consumption-first).
- In-app subscriptions / IAP (re-uses Razorpay/Stripe web).
- Native chat tool cards (mobile chat shows text only; tool flows live
  in the web app).
- Multi-device sync UI (works automatically because everything is
  server-state).

## Decision log

| Decision | Rationale |
|---|---|
| RN/Expo over PWA | Push notification reliability on iOS |
| Re-use bearer auth from extension | Same code path; one auth surface to harden |
| Mobile is consumption-first | Cold prospecting belongs on desktop; phone is for triage |
| No new backend except push registration | Avoids forking the API surface |
| Expo Push API (not direct FCM/APNs) | Single vendor for both platforms |

## Sequencing

1. **Pre-req:** ship a real production Vercel URL (`API_BASE`); the
   extension and mobile both need this fixed.
2. Backend: `push_tokens` migration + `/api/extension/push-register`
   + push-firing in the existing reply/automation paths.
3. Mobile: Expo app shell + auth + four screens above.
4. TestFlight / internal track.
5. App-store submission.

Phase 6 deliverable is points 2 and 3 only — apps-store distribution
follows once the product is validated with internal users.
