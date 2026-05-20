-- =====================================================================
-- LeadGenAI — 0004_sending.sql
-- The send leg: connected mailboxes, campaigns, per-recipient state,
-- event log, and a global suppression list. Implements SENDING_AGENT.md.
-- =====================================================================

-- ---------------------------------------------------------------------
-- mailboxes — a connected Gmail account the user sends from.
-- OAuth tokens stored here (encrypt at rest with pgsodium in prod).
-- daily_send_limit ramps over the warm-up window; daily_sent resets
-- each calendar day (handled in app logic).
-- ---------------------------------------------------------------------
create table if not exists public.mailboxes (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null default 'gmail' check (provider in ('gmail','outlook')),
  email_address text not null,
  oauth_refresh_token text not null,
  daily_send_limit int not null default 10,       -- ramps: 10→20→35→50
  daily_sent int not null default 0,
  last_reset_at timestamptz not null default now(),
  warmup_started_at timestamptz not null default now(),
  physical_address text,                            -- CAN-SPAM requirement
  status text not null default 'active'
    check (status in ('active','paused','disconnected')),
  created_at timestamptz not null default now(),
  unique (user_id, email_address)
);
create index if not exists mailboxes_user_idx on public.mailboxes(user_id);

-- ---------------------------------------------------------------------
-- campaigns — a send run built from a sequence + a set of prospects.
-- ---------------------------------------------------------------------
create table if not exists public.campaigns (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  mailbox_id uuid not null references public.mailboxes(id) on delete cascade,
  sequence_id uuid references public.sequences(id),
  source_job_id uuid references public.jobs(id),
  name text not null,
  status text not null default 'draft'
    check (status in ('draft','review','active','paused','completed','aborted')),
  daily_cap int not null default 30,
  send_window_start_hour int not null default 9,
  send_window_end_hour int not null default 17,
  timezone text not null default 'Asia/Kolkata',
  lawful_basis text not null default 'legitimate_interest_b2b'
    check (lawful_basis in ('legitimate_interest_b2b','prior_consent','public_data')),
  bounce_rate_pct numeric(5,2) default 0,
  reply_rate_pct numeric(5,2) default 0,
  created_at timestamptz not null default now(),
  unlocked_at timestamptz,
  completed_at timestamptz
);
create index if not exists campaigns_user_idx on public.campaigns(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- campaign_recipients — one row per (campaign, prospect). Holds a
-- frozen copy of the personalized content at enrollment time so later
-- edits to the prospect don't change what's queued/sent.
-- ---------------------------------------------------------------------
create table if not exists public.campaign_recipients (
  id uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete set null,
  email text not null,
  subject text not null,
  body text not null,
  status text not null default 'pending' check (status in (
    'pending','approved','scheduled','sent','opened',
    'bounced','replied','unsubscribed','failed','skipped'
  )),
  scheduled_for timestamptz,
  sent_at timestamptz,
  opened_at timestamptz,
  message_id text,
  thread_id text,
  bounce_reason text,
  reply_at timestamptz,
  created_at timestamptz not null default now()
);
create index if not exists campaign_recipients_campaign_idx
  on public.campaign_recipients(campaign_id, status);
create index if not exists campaign_recipients_due_idx
  on public.campaign_recipients(scheduled_for)
  where status = 'scheduled';
create index if not exists campaign_recipients_thread_idx
  on public.campaign_recipients(thread_id)
  where thread_id is not null;

-- ---------------------------------------------------------------------
-- email_events — append-only event log per recipient.
-- ---------------------------------------------------------------------
create table if not exists public.email_events (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.campaign_recipients(id) on delete cascade,
  event_type text not null check (event_type in (
    'queued','sent','opened','bounced','replied','auto_reply',
    'clicked','unsubscribed','marked_spam','failed'
  )),
  payload jsonb,
  occurred_at timestamptz not null default now()
);
create index if not exists email_events_recipient_idx
  on public.email_events(recipient_id, occurred_at desc);

-- ---------------------------------------------------------------------
-- reply_classifications — Claude's read on each inbound reply.
-- ---------------------------------------------------------------------
create table if not exists public.reply_classifications (
  id uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.campaign_recipients(id) on delete cascade,
  category text not null check (category in (
    'interested','question','objection','out_of_office',
    'unsubscribe','not_interested','other'
  )),
  confidence numeric(4,3),
  snippet text,
  needs_human boolean not null default false,
  handled boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists reply_classifications_human_idx
  on public.reply_classifications(needs_human, handled)
  where needs_human = true and handled = false;

-- ---------------------------------------------------------------------
-- suppressions — global per-user do-not-contact list.
-- ---------------------------------------------------------------------
create table if not exists public.suppressions (
  user_id uuid not null references public.users(id) on delete cascade,
  email_hash text not null,                        -- sha256(lower(email))
  reason text not null check (reason in ('bounced','unsubscribed','complained','manual')),
  created_at timestamptz not null default now(),
  primary key (user_id, email_hash)
);

-- ---------------------------------------------------------------------
-- RLS
-- ---------------------------------------------------------------------
alter table public.mailboxes             enable row level security;
alter table public.campaigns             enable row level security;
alter table public.campaign_recipients   enable row level security;
alter table public.email_events          enable row level security;
alter table public.reply_classifications enable row level security;
alter table public.suppressions          enable row level security;

drop policy if exists "own mailboxes" on public.mailboxes;
create policy "own mailboxes" on public.mailboxes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own campaigns" on public.campaigns;
create policy "own campaigns" on public.campaigns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own recipients" on public.campaign_recipients;
create policy "own recipients" on public.campaign_recipients
  for all using (
    exists (
      select 1 from public.campaigns c
       where c.id = campaign_recipients.campaign_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "own events" on public.email_events;
create policy "own events" on public.email_events
  for select using (
    exists (
      select 1 from public.campaign_recipients r
        join public.campaigns c on c.id = r.campaign_id
       where r.id = email_events.recipient_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "own classifications" on public.reply_classifications;
create policy "own classifications" on public.reply_classifications
  for all using (
    exists (
      select 1 from public.campaign_recipients r
        join public.campaigns c on c.id = r.campaign_id
       where r.id = reply_classifications.recipient_id and c.user_id = auth.uid()
    )
  );

drop policy if exists "own suppressions" on public.suppressions;
create policy "own suppressions" on public.suppressions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);
