# Sending Agent — v2 Specification

**Version:** v0.1 of v2 spec
**Status:** Deferred from v1. Do not build until v1 has revenue.
**Estimated build:** 3-5 weeks after v1 is shipping reliably

> **Why this is deferred:** Deliverability infrastructure is a deep specialty. Cold-email regulatory exposure shifts from "the user is responsible" to "we are co-responsible" the moment we operate the send. Build only after v1 proves the AI-personalization wedge actually drives reply uplift — otherwise we'd build the riskiest part of the product before knowing if the safest part works.

---

## 1. Product summary

After v1, users have a Sheet of enriched prospects with AI-drafted personalized emails. They open Lemlist/Instantly/Smartlead and paste the Sheet in. **The v2 sending agent removes this step.** It connects to the user's Gmail, sends the emails on a throttled schedule, detects replies, and stops cascades on reply. The campaign feels autonomous to the user — they review the first few drafts, then walk away.

---

## 2. Locked decisions (from 2026-05-09 spec session)

| Decision | Choice | Notes |
|---|---|---|
| Send-from infrastructure | **User's Gmail (OAuth)** | Outlook in v2.1; managed SMTP never (different business) |
| Autonomy level | **Fully autonomous, with first-batch review gate** | User's stated preference was "fully autonomous" — we add a 3-5 message review gate as a safety pattern, not as a feature reduction |
| Reply handling | **Stop + notify user** | AI categorization in v2.1; auto-reply in v2.2 if at all |
| Channels | **Email only** | LinkedIn / WhatsApp = separate v3 conversations |

---

## 3. The autonomy pattern (push-back on pure-autonomous)

Pure "click go and we email 50 strangers" has a single failure mode that ends the product: one bad email × 50 recipients = a user's primary domain in spam folders, blaming you. The proven pattern in 2026 SDR tooling:

**Stage 1: setup (one-time per campaign)** — 90 seconds
1. Campaign created from a Sheet/CSV/chat search results
2. Agent shows campaign summary: 50 recipients, expected daily send rate (10/day), 5-day duration, voice anchor
3. Agent shows the **first 3-5 drafts side by side** for review/edit
4. User approves → campaign unlocks

**Stage 2: autonomous execution** — days to weeks
5. Scheduler ticks every 15 min; sends throttle-aware (more on §6)
6. Each send is independent — no batch dependency
7. Reply detected → stop sending to that contact, notify user, never resume
8. Bounce detected → mark contact `bounced`, exclude from any future campaigns
9. Unsubscribe link clicked → mark contact `unsubscribed`, suppress globally

**Stage 3: signals + auto-pause** — continuous
10. If bounce rate > 5% in any rolling 50-send window → pause campaign, alert user
11. If reply rate < 0.5% after 30 sends → suggest pause (data signal: bad targeting or bad copy)
12. If reply rate > 30% → confirm with user it's genuine (could be auto-replies)

The user *experiences* this as autonomous. The system has guardrails that the user only notices if something is wrong.

---

## 4. Architecture additions (delta on top of v0.2)

### New tables

```sql
-- supabase/migrations/0005_campaigns.sql

create table mailboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  provider text not null check (provider in ('gmail','outlook')),
  email_address text not null,
  oauth_access_token text not null,           -- encrypted at rest
  oauth_refresh_token text not null,
  oauth_expires_at timestamptz not null,
  daily_send_limit int not null default 50,    -- ramps over first 14 days
  daily_sent int not null default 0,
  last_reset_at timestamptz not null default now(),
  warmup_started_at timestamptz,
  status text not null default 'active' check (status in ('active','paused','disconnected')),
  created_at timestamptz not null default now(),
  unique (user_id, email_address)
);

create table campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  mailbox_id uuid not null references mailboxes(id),
  source_job_id uuid references jobs(id),       -- where the contact list came from
  name text not null,
  status text not null default 'draft' check (status in ('draft','review','active','paused','completed','aborted')),
  daily_cap int not null default 30,
  send_window_start_hour int not null default 9,   -- local time
  send_window_end_hour int not null default 17,
  timezone text not null default 'Asia/Kolkata',
  approved_drafts_count int not null default 0,    -- reviewed/edited by user before unlock
  approval_required int not null default 3,        -- gate threshold
  bounce_rate_pct numeric(5,2) default 0,
  reply_rate_pct numeric(5,2) default 0,
  created_at timestamptz not null default now(),
  unlocked_at timestamptz,
  completed_at timestamptz
);

create table campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references campaigns(id) on delete cascade,
  prospect_id uuid references prospects(id),       -- nullable for CSV-only sends
  email text not null,
  -- Frozen copy of personalized content at time of campaign creation
  subject text not null,
  body text not null,
  status text not null check (status in ('pending','approved','scheduled','sent','bounced','replied','unsubscribed','failed','skipped')) default 'pending',
  scheduled_for timestamptz,
  sent_at timestamptz,
  message_id text,                                 -- Gmail message ID after send
  thread_id text,                                  -- Gmail thread ID for reply tracking
  bounce_reason text,
  reply_at timestamptz,
  created_at timestamptz not null default now()
);
create index on campaign_recipients(campaign_id, status);
create index on campaign_recipients(scheduled_for) where status = 'scheduled';
create index on campaign_recipients(thread_id) where thread_id is not null;

create table email_events (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references campaign_recipients(id) on delete cascade,
  event_type text not null check (event_type in ('queued','sent','bounced','replied','clicked','unsubscribed','marked_spam')),
  payload jsonb,
  occurred_at timestamptz not null default now()
);
create index on email_events(recipient_id, occurred_at desc);

-- Global suppression list (per user)
create table suppressions (
  user_id uuid not null references users(id) on delete cascade,
  email_hash text not null,                        -- sha256 of normalized email
  reason text not null check (reason in ('bounced','unsubscribed','complained','manual')),
  created_at timestamptz not null default now(),
  primary key (user_id, email_hash)
);
```

### New Inngest functions

```
inngest/functions/
├── campaign-scheduler.ts            # cron every 15min, dispatches scheduled sends
├── send-email.ts                    # single send via Gmail API
├── reply-detector.ts                # polls Gmail or handles Pub/Sub push
├── bounce-detector.ts               # parses bounce messages from inbox
└── campaign-health-monitor.ts       # checks bounce rate, reply rate, auto-pauses
```

### New tools for the chat agent

```typescript
// lib/agent/tools.ts (additions)

create_campaign: tool({
  description: "Create a new outbound email campaign from a list of prospects with drafts. Always show the user the campaign summary and first 3 drafts for review before unlocking.",
  parameters: z.object({
    prospect_ids: z.array(z.string().uuid()),
    mailbox_id: z.string().uuid(),
    daily_cap: z.number().min(1).max(100).default(30),
    name: z.string(),
  }),
  execute: async (params, { userId }) => {
    return await createCampaign({ ...params, userId });
  },
}),

unlock_campaign: tool({
  description: "After the user has reviewed the first batch of drafts, unlock the campaign for autonomous sending. Requires explicit user confirmation.",
  parameters: z.object({ campaign_id: z.string().uuid() }),
  execute: async (params, { userId }) => {
    return await unlockCampaign({ ...params, userId });
  },
}),

pause_campaign: tool({
  description: "Pause a running campaign. Use when the user asks, or when health monitors detect a problem.",
  parameters: z.object({ campaign_id: z.string().uuid(), reason: z.string() }),
  execute: async (params, { userId }) => {
    return await pauseCampaign({ ...params, userId });
  },
}),
```

---

## 5. The send path

### 5.1 Gmail OAuth setup

- Scopes: `https://www.googleapis.com/auth/gmail.send` + `https://www.googleapis.com/auth/gmail.readonly` + `https://www.googleapis.com/auth/gmail.metadata`
- `gmail.readonly` is needed to detect replies. Explain this clearly at consent screen — users get nervous.
- Store refresh token encrypted (pgsodium). Refresh access token via `google-auth-library`.
- Verify the connected address matches the user's claimed `from` address.

### 5.2 Send-rate ramp (the warm-up curve)

A brand-new mailbox sending 50 cold emails on day 1 will land in spam. The agent enforces:

| Day from connection | Max sends/day |
|---|---|
| 1-3 | 10 |
| 4-7 | 20 |
| 8-14 | 35 |
| 15+ | 50 (user can raise to 100 manually) |

This is enforced server-side. UI shows the current cap so users know why.

### 5.3 The scheduler

```typescript
// inngest/functions/campaign-scheduler.ts

export const campaignScheduler = inngest.createFunction(
  { id: "campaign-scheduler" },
  { cron: "*/15 * * * *" },          // every 15 minutes
  async ({ step }) => {
    const due = await step.run("find-due", async () => {
      // Find scheduled_for <= now() across active campaigns
      // Within send-window hours (local time)
      // Respecting per-mailbox daily cap (daily_sent < daily_send_limit)
      return await findDueRecipients();
    });

    // Fan out per-recipient sends (concurrency 1 per mailbox)
    await step.sendEvent("dispatch", due.map((r) => ({
      name: "email/send",
      data: { recipientId: r.id, campaignId: r.campaign_id, mailboxId: r.mailbox_id },
    })));
  },
);
```

### 5.4 The actual send

```typescript
// inngest/functions/send-email.ts

export const sendEmail = inngest.createFunction(
  { id: "send-email", concurrency: { limit: 1, key: "event.data.mailboxId" }, retries: 2 },
  { event: "email/send" },
  async ({ event, step }) => {
    const { recipientId, mailboxId } = event.data;

    // 1. Reload state (defensive — campaign could have been paused)
    const r = await step.run("load", () => loadRecipient(recipientId));
    if (r.status !== "scheduled") return { skipped: true, reason: r.status };

    // 2. Suppression check (last-mile)
    const suppressed = await step.run("check-suppression", () => isSuppressed(r.user_id, r.email));
    if (suppressed) {
      await markStatus(r.id, "skipped", "suppression_match");
      return { skipped: true };
    }

    // 3. Inject unsubscribe footer
    const body = appendUnsubscribeFooter(r.body, r.id);

    // 4. Send via Gmail API
    const sent = await step.run("send", async () => {
      const auth = await getMailboxAuth(mailboxId);
      const gmail = google.gmail({ version: "v1", auth });
      const raw = buildRawMime({ to: r.email, subject: r.subject, body });
      const res = await gmail.users.messages.send({
        userId: "me",
        requestBody: { raw: Buffer.from(raw).toString("base64url") },
      });
      return { messageId: res.data.id!, threadId: res.data.threadId! };
    });

    // 5. Persist
    await step.run("persist", async () => {
      await updateRecipient(r.id, {
        status: "sent",
        sent_at: new Date().toISOString(),
        message_id: sent.messageId,
        thread_id: sent.threadId,
      });
      await incrementMailboxDailySent(mailboxId);
      await logEvent(r.id, "sent");
    });
  },
);
```

---

## 6. Reply detection (the hard part)

Two implementation options:

**Option A — Gmail push via Pub/Sub.** Most efficient. Gmail watches the user's inbox; on each new message, Google publishes to a GCP Pub/Sub topic; you listen, fetch the message, check if `In-Reply-To` matches a `thread_id` you sent. Real-time. Requires a GCP project + topic per environment. **Recommended.**

**Option B — IMAP polling.** Poll user's Gmail every 5-10 min via IMAP. Simpler infra, higher latency, hits rate limits at scale. Use only as fallback.

```typescript
// inngest/functions/reply-detector.ts (push variant)

export const onGmailPush = inngest.createFunction(
  { id: "gmail-push" },
  { event: "gmail/push" },              // triggered by Pub/Sub webhook
  async ({ event, step }) => {
    const { messageId, mailboxEmail } = event.data;

    const msg = await step.run("fetch", () => fetchGmailMessage(messageId));

    // Is this a reply to one of our sends?
    const inReplyTo = msg.headers["In-Reply-To"];
    if (!inReplyTo) return;

    const recipient = await step.run("match", () => findRecipientByMessageId(inReplyTo));
    if (!recipient) return;

    // Classify (heuristic v0.1; AI in v2.1)
    const isAutoReply = /out of office|on vacation|i am away|auto-reply|automatic reply/i.test(msg.snippet);
    const isBounce = msg.from.includes("mailer-daemon") || msg.from.includes("postmaster");

    if (isBounce) {
      await markBounced(recipient.id, msg.snippet);
      await suppressEmail(recipient.user_id, recipient.email, "bounced");
    } else if (isAutoReply) {
      // Don't stop the cascade for auto-replies; log only
      await logEvent(recipient.id, "auto_reply");
    } else {
      // Real reply
      await markReplied(recipient.id);
      await stopCampaignForContact(recipient.campaign_id, recipient.email);
      await notifyUser(recipient.user_id, recipient);
    }
  },
);
```

---

## 7. Compliance — non-negotiable

Every outbound email MUST include:

1. **Unsubscribe link** that works in one click, no login required. Token-signed URL, recorded in `email_events`. CAN-SPAM (US), GDPR (EU), DPDP (India) all require this.
2. **Physical sender address** — the user's claimed business address, captured at mailbox-connection time. CAN-SPAM requires.
3. **Honest subject line + from name.** No deceptive headers. The agent's prompt forbids subject manipulation.
4. **Suppression list honored globally.** If recipient X unsubscribes from any campaign, they never receive another from this user's account.

We provide the unsubscribe handler endpoint (`/u/[token]`) — clicking it suppresses + redirects to a confirmation page. Token is HMAC-signed; expires in 90 days.

**India DPDP specifics (2026):** consent records must be maintained. For cold outreach to business contacts, "legitimate interest" is the typical basis but it must be documented per campaign. Add a campaign-creation field: `lawful_basis: 'legitimate_interest_b2b' | 'prior_consent' | 'public_data'` and require user to attest.

---

## 8. Cost model

Per 50-recipient campaign:
- Gmail API send: free (subject to user's daily quota)
- Reply detection (Pub/Sub push): ~$0 at this scale
- Storage: negligible
- Our infrastructure: minimal incremental cost

**The cost is in v1's enrichment + drafting, which already happened.** v2 sending adds almost no marginal compute cost. The cost is in dev time (3-5 weeks) and ongoing deliverability-support load (users will email asking why their open rate dropped).

---

## 9. Pricing impact

Once sending is live, restructure plans:

| Plan | v1 (no send) | v2 (with send) |
|---|---|---|
| Free | 25 prospects/mo | 25 prospects/mo, no send |
| Starter ₹999 | 250 prospects, Sheet only | 250 prospects + send 100/mo |
| Pro ₹2,999 | 1,000 prospects, Sheet only | 1,000 prospects + send 500/mo |
| Agency ₹9,999 | 5,000 prospects | 5,000 prospects + send 2,500/mo + multi-mailbox |

Sending becomes the value capture for the higher tiers. Free tier never gets send (deliverability risk + abuse).

---

## 10. Risks specific to v2

| Risk | Mitigation |
|---|---|
| User's domain reputation tanked by our throttling bug | Hard-coded warm-up curve; aggressive bounce/spam-rate auto-pause; clear documentation that users should use dedicated sending inboxes for outbound |
| Spam complaints attached to our IP (if user uses Gmail aliases) | We don't operate the send IP — Gmail does. Our exposure is limited to "we facilitated." Still — terms of service must require users to attest opt-in or legitimate B2B basis. |
| Gmail API quota hit | Per-user OAuth has its own quota; not pooled. Standard per-user limits are generous. Monitor. |
| Reply detection misses a real reply (classifier failure) → user sends follow-up to someone who already replied | Auto-pause if any recipient receives a follow-up within 24h of a detected reply on the same thread; log + alert |
| GDPR/DPDP enforcement against the platform | Strong unsubscribe + lawful-basis attestation per campaign + 90-day audit log |
| Indian regulatory tightening of cold outbound | Track DPDP rule-making; we can pivot to opt-in only model in 30 days if required |

---

## 11. v2 build sequence (when v1 is shipping)

- **Week 1:** Gmail OAuth (send + readonly + metadata scopes); mailbox warm-up curve; suppression schema.
- **Week 2:** Campaign creation flow; recipient seeding from `prospects`; review-gate UI for first 3-5 drafts.
- **Week 3:** Scheduler + send worker; daily cap enforcement; throttle; send window respect.
- **Week 4:** Reply detection via Gmail Pub/Sub; bounce detection; auto-pause health monitors.
- **Week 5:** Unsubscribe handler; compliance attestation; admin dashboard for campaign health; polish.

5 weeks for a single-channel, single-provider (Gmail-only) sending agent with first-batch gate. Outlook = +1 week in v2.1.

---

## 12. What's still not in v2

- Multi-step sequences (follow-ups) — v2.1
- A/B testing of subject lines — v2.1
- Send-time optimization based on recipient timezone — v2.2
- Outlook / Microsoft 365 support — v2.1
- LinkedIn outreach — v3
- WhatsApp Business — v3
- AI auto-reply to replies — never without explicit per-message approval

---

*End of SENDING_AGENT.md v0.1. Refer back during v2 build. Update if Gmail API or DPDP rules change materially.*
