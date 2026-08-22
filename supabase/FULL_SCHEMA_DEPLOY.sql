-- LeadGenAI Complete Database Schema
-- Auto-consolidated for one-click deployment


-- ==========================================
-- Migration: 00000000000001_schema_init.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0001_init.sql
-- Initial schema for the v0.5 chat-first MVP. Applies cleanly to a
-- fresh Supabase project. Idempotent: safe to re-run.
--
-- Apply with:  supabase db push
--          or  psql $DATABASE_URL -f supabase/migrations/0001_init.sql
-- =====================================================================

create extension if not exists pgcrypto;

-- ---------------------------------------------------------------------
-- users — application profile + plan state.
-- id mirrors auth.users(id) so the auth callback's upsert lines up.
-- ---------------------------------------------------------------------
create table if not exists public.users (
  id uuid primary key references auth.users(id) on delete cascade,
  email text unique not null,
  google_refresh_token text,
  plan text not null default 'free'
    check (plan in ('free','starter','pro','agency')),
  credits_remaining int not null default 25,
  credits_reset_at timestamptz not null default (now() + interval '30 days'),
  voice_anchor_text text,
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- chat_sessions / chat_messages — conversational history.
-- content is jsonb so assistant tool-call streams persist losslessly.
-- ---------------------------------------------------------------------
create table if not exists public.chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index if not exists chat_sessions_user_idx
  on public.chat_sessions(user_id, last_message_at desc);

create table if not exists public.chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool','system')),
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index if not exists chat_messages_session_idx
  on public.chat_messages(session_id, created_at);

-- ---------------------------------------------------------------------
-- prospect_candidates — short-lived discovery results surfaced by the agent
-- ---------------------------------------------------------------------
create table if not exists public.prospect_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references public.chat_sessions(id) on delete cascade,
  source text not null
    check (source in ('brave','duckduckgo','github','producthunt','hn','csv','named','mock')),
  source_ref text,
  preview jsonb not null,
  selected boolean default false,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);
create index if not exists prospect_candidates_session_idx
  on public.prospect_candidates(session_id);

-- ---------------------------------------------------------------------
-- jobs / prospects — committed enrichment runs
-- ---------------------------------------------------------------------
create table if not exists public.jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  source_session_id uuid references public.chat_sessions(id),
  input_source text not null default 'chat_search'
    check (input_source in ('chat_search','chat_enrich','csv_upload')),
  status text not null default 'pending'
    check (status in ('pending','processing','completed','failed','cancelled')),
  prospect_count int not null default 0,
  sheet_url text,
  csv_url text,
  error_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists jobs_user_idx on public.jobs(user_id, created_at desc);

create table if not exists public.prospects (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references public.jobs(id) on delete cascade,
  input_source text not null,
  input_name text,
  input_company text,
  input_linkedin_url text,
  status text not null default 'pending'
    check (status in ('pending','enriching','researching','drafting','completed','failed')),
  company_domain text,
  company_data jsonb,
  recent_news jsonb,
  email text,
  email_source text check (email_source in ('extracted','pattern_guessed','none')),
  email_confidence text check (email_confidence in ('valid','risky','invalid','unknown')),
  research_summary text,
  email_subject text,
  email_body text,
  talking_points jsonb,
  error_reason text,
  cost_cents int default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index if not exists prospects_job_idx on public.prospects(job_id);
create index if not exists prospects_status_idx on public.prospects(status);

-- ---------------------------------------------------------------------
-- scrape_cache — single most important cost-control table
-- ---------------------------------------------------------------------
create table if not exists public.scrape_cache (
  cache_key text primary key,
  scrape_type text not null,
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index if not exists scrape_cache_expiry_idx
  on public.scrape_cache(expires_at);

-- ---------------------------------------------------------------------
-- credit_transactions — append-only ledger
-- ---------------------------------------------------------------------
create table if not exists public.credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  delta int not null,
  reason text not null,
  job_id uuid references public.jobs(id),
  created_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- webhook_events — idempotency table for Stripe / Razorpay / Gmail push
-- ---------------------------------------------------------------------
create table if not exists public.webhook_events (
  id text primary key,
  provider text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

-- ---------------------------------------------------------------------
-- Row-Level Security — every user-data table is locked down.
-- Workers / admin paths must use the service-role key to bypass RLS.
-- ---------------------------------------------------------------------
alter table public.users               enable row level security;
alter table public.chat_sessions       enable row level security;
alter table public.chat_messages       enable row level security;
alter table public.prospect_candidates enable row level security;
alter table public.jobs                enable row level security;
alter table public.prospects           enable row level security;
alter table public.credit_transactions enable row level security;

drop policy if exists "own user row select" on public.users;
create policy "own user row select" on public.users
  for select using (auth.uid() = id);

drop policy if exists "own user row update" on public.users;
create policy "own user row update" on public.users
  for update using (auth.uid() = id);

drop policy if exists "own sessions" on public.chat_sessions;
create policy "own sessions" on public.chat_sessions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own messages" on public.chat_messages;
create policy "own messages" on public.chat_messages
  for all using (
    exists (
      select 1 from public.chat_sessions s
       where s.id = chat_messages.session_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "own candidates" on public.prospect_candidates;
create policy "own candidates" on public.prospect_candidates
  for all using (
    exists (
      select 1 from public.chat_sessions s
       where s.id = prospect_candidates.session_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "own jobs" on public.jobs;
create policy "own jobs" on public.jobs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own prospects" on public.prospects;
create policy "own prospects" on public.prospects
  for select using (
    exists (
      select 1 from public.jobs j
       where j.id = prospects.job_id and j.user_id = auth.uid()
    )
  );

drop policy if exists "own credit txn" on public.credit_transactions;
create policy "own credit txn" on public.credit_transactions
  for select using (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Trigger: bump chat_sessions.last_message_at whenever a message lands
-- ---------------------------------------------------------------------
create or replace function public.touch_session_last_message_at()
returns trigger language plpgsql security definer as $$
begin
  update public.chat_sessions
     set last_message_at = now()
   where id = new.session_id;
  return new;
end $$;

drop trigger if exists trg_touch_session on public.chat_messages;
create trigger trg_touch_session
  after insert on public.chat_messages
  for each row execute function public.touch_session_last_message_at();


-- ==========================================
-- Migration: 00000000000002_prospect_stage.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0002_prospect_stage.sql
-- Adds the pipeline kanban stage column to prospects.
-- Safe to re-run (idempotent via IF NOT EXISTS / IF EXISTS guards).
-- =====================================================================

-- Add stage column: nullable so enriched-but-unsent prospects sit outside
-- the kanban until the user explicitly marks contact status.
alter table public.prospects
  add column if not exists stage text
    check (stage in ('contacted','replied','interested','converted','unsubscribed'));

-- Efficient queries for the pipeline page (filter by user via join to jobs).
create index if not exists prospects_stage_idx
  on public.prospects(stage)
  where stage is not null;

-- Allow users to update stage on their own prospects.
-- The existing select policy uses the same jobs join — mirror it here.
drop policy if exists "own prospects update" on public.prospects;
create policy "own prospects update" on public.prospects
  for update
  using (
    exists (
      select 1 from public.jobs j
       where j.id = prospects.job_id and j.user_id = auth.uid()
    )
  )
  with check (
    exists (
      select 1 from public.jobs j
       where j.id = prospects.job_id and j.user_id = auth.uid()
    )
  );


-- ==========================================
-- Migration: 00000000000003_rls_insert_policies.sql
-- ==========================================

-- 0002: add missing insert/update rls policies
-- the initial schema (0001) only had select policies but sign-in needs
-- to upsert the user row, and the chat + jobs flows need to write rows.

-- users: allow insert and update on own row
create policy "users can insert own row" on users
  for insert with check (auth.uid() = id);

create policy "users can update own row" on users
  for update using (auth.uid() = id);

-- chat sessions: allow insert
create policy "own sessions insert" on chat_sessions
  for insert with check (auth.uid() = user_id);

create policy "own sessions update" on chat_sessions
  for update using (auth.uid() = user_id);

-- chat messages: allow insert (check ownership via session)
create policy "own messages insert" on chat_messages
  for insert with check (
    exists (
      select 1 from chat_sessions s
      where s.id = chat_messages.session_id
        and s.user_id = auth.uid()
    )
  );

-- jobs: allow insert and update
create policy "own jobs insert" on jobs
  for insert with check (auth.uid() = user_id);

create policy "own jobs update" on jobs
  for update using (auth.uid() = user_id);

-- prospects: allow insert and update via job ownership
create policy "own prospects insert" on prospects
  for insert with check (
    exists (
      select 1 from jobs j
      where j.id = prospects.job_id
        and j.user_id = auth.uid()
    )
  );

drop policy if exists "own prospects update" on prospects;
create policy "own prospects update" on prospects
  for update using (
    exists (
      select 1 from jobs j
      where j.id = prospects.job_id
        and j.user_id = auth.uid()
    )
  );

-- prospect_candidates: allow insert
create policy "own candidates insert" on prospect_candidates
  for insert with check (
    exists (
      select 1 from chat_sessions s
      where s.id = prospect_candidates.session_id
        and s.user_id = auth.uid()
    )
  );

-- credit_transactions: allow insert on own row
create policy "own credit transactions insert" on credit_transactions
  for insert with check (auth.uid() = user_id);


-- ==========================================
-- Migration: 00000000000005_sequences.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0002_sequences.sql
-- Multi-step outreach sequence model. Data-only in v1.0; the send leg
-- (mailboxes, campaign_recipients, email_events) lands in migration 0004
-- alongside Gmail OAuth.
-- =====================================================================

create table if not exists public.sequences (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  description text,
  is_active boolean not null default true,
  created_at timestamptz not null default now()
);
create index if not exists sequences_user_idx
  on public.sequences(user_id, created_at desc);

create table if not exists public.sequence_steps (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  step_order int not null,
  day_offset int not null default 0,
  channel text not null check (channel in ('email','linkedin_dm','task')),
  subject_template text,
  body_template text not null,
  created_at timestamptz not null default now(),
  unique (sequence_id, step_order)
);
create index if not exists sequence_steps_seq_idx
  on public.sequence_steps(sequence_id, step_order);

create table if not exists public.sequence_enrollments (
  id uuid primary key default gen_random_uuid(),
  sequence_id uuid not null references public.sequences(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,
  enrolled_at timestamptz not null default now(),
  current_step int not null default 0,
  status text not null default 'active'
    check (status in ('active','paused','completed','replied','bounced','unsubscribed'))
);
create index if not exists sequence_enrollments_seq_idx
  on public.sequence_enrollments(sequence_id);
create index if not exists sequence_enrollments_prospect_idx
  on public.sequence_enrollments(prospect_id);

-- RLS
alter table public.sequences            enable row level security;
alter table public.sequence_steps       enable row level security;
alter table public.sequence_enrollments enable row level security;

drop policy if exists "own sequences" on public.sequences;
create policy "own sequences" on public.sequences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own sequence steps" on public.sequence_steps;
create policy "own sequence steps" on public.sequence_steps
  for all using (
    exists (
      select 1 from public.sequences s
       where s.id = sequence_steps.sequence_id and s.user_id = auth.uid()
    )
  );

drop policy if exists "own sequence enrollments" on public.sequence_enrollments;
create policy "own sequence enrollments" on public.sequence_enrollments
  for all using (
    exists (
      select 1 from public.sequences s
       where s.id = sequence_enrollments.sequence_id and s.user_id = auth.uid()
    )
  );


-- ==========================================
-- Migration: 00000000000006_intent.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0003_intent.sql
-- Intent trigger feed: signals that flag "someone worth reaching out to
-- right now" (funding, hires, big posts). Populated by /api/cron/poll-intent.
-- =====================================================================

create table if not exists public.intent_triggers (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  trigger_type text not null check (trigger_type in (
    'funding','hiring','job_change','product_launch','press_mention',
    'github_star_spike','hn_post','tech_change'
  )),
  account_name text,
  account_domain text,
  payload jsonb not null,
  source_url text,
  surfaced boolean not null default false,
  dismissed boolean not null default false,
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);
create index if not exists intent_triggers_user_idx
  on public.intent_triggers(user_id, occurred_at desc);
create index if not exists intent_triggers_unsurfaced_idx
  on public.intent_triggers(user_id, surfaced)
  where surfaced = false;

-- Per-user tracked keywords (drives the cron scan).
create table if not exists public.intent_watches (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  query text not null,
  sources text[] not null default '{hn_algolia,github}',
  created_at timestamptz not null default now()
);
create index if not exists intent_watches_user_idx
  on public.intent_watches(user_id);

alter table public.intent_triggers enable row level security;
alter table public.intent_watches  enable row level security;

drop policy if exists "own triggers" on public.intent_triggers;
create policy "own triggers" on public.intent_triggers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own watches" on public.intent_watches;
create policy "own watches" on public.intent_watches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ==========================================
-- Migration: 00000000000007_sending.sql
-- ==========================================

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


-- ==========================================
-- Migration: 00000000000008_consolidate.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0005_consolidate.sql
-- Reconciler / healing migration for the send pipeline.
--
-- The send tables were defined in BOTH 0002_sequences_sending.sql
-- (denormalized user_id — the shape the app code requires) and the older,
-- superseded 0004_sending.sql (join-based RLS, NO user_id). Because every
-- CREATE uses "if not exists", whichever applied first wins. A database
-- migrated before 0002_sequences_sending.sql existed can therefore be
-- missing the user_id columns that launch_campaign, send-due, detect-replies
-- and the RLS policies all depend on — silently breaking the send/reply flow.
--
-- This migration is ADDITIVE and IDEMPOTENT. It only adds the user_id
-- columns (if absent), backfills them from the owning campaign, and ensures
-- the canonical user_id-based RLS policy exists. It never drops columns or
-- data, and is a no-op on a database already at the canonical shape.
-- 0004_sending.sql is left in place (immutable) but is fully superseded by
-- 0002_sequences_sending.sql + this migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- campaign_recipients.user_id — inserted by launch_campaign, read by send-due
-- ---------------------------------------------------------------------
alter table public.campaign_recipients
  add column if not exists user_id uuid references public.users(id) on delete cascade;

update public.campaign_recipients r
   set user_id = c.user_id
  from public.campaigns c
 where r.campaign_id = c.id and r.user_id is null;

create index if not exists campaign_recipients_user_idx
  on public.campaign_recipients(user_id, created_at desc);

drop policy if exists "own recipients" on public.campaign_recipients;
drop policy if exists "own campaign recipients" on public.campaign_recipients;
create policy "own campaign recipients" on public.campaign_recipients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- reply_classifications.user_id — written by detect-replies, read by inbox
-- ---------------------------------------------------------------------
alter table public.reply_classifications
  add column if not exists user_id uuid references public.users(id) on delete cascade;

update public.reply_classifications rc
   set user_id = c.user_id
  from public.campaign_recipients r
  join public.campaigns c on c.id = r.campaign_id
 where rc.recipient_id = r.id and rc.user_id is null;

drop policy if exists "own classifications" on public.reply_classifications;
drop policy if exists "own reply classifications" on public.reply_classifications;
create policy "own reply classifications" on public.reply_classifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- email_events.user_id — written by send-due/detect-replies, read by analytics
-- (single-column index only: the older shape names its timestamp occurred_at,
--  so we avoid referencing created_at here to stay shape-agnostic.)
-- ---------------------------------------------------------------------
alter table public.email_events
  add column if not exists user_id uuid references public.users(id) on delete cascade;

update public.email_events e
   set user_id = c.user_id
  from public.campaign_recipients r
  join public.campaigns c on c.id = r.campaign_id
 where e.recipient_id = r.id and e.user_id is null;

create index if not exists email_events_userid_idx
  on public.email_events(user_id);

drop policy if exists "own events" on public.email_events;
drop policy if exists "own email events" on public.email_events;
create policy "own email events" on public.email_events
  for select using (auth.uid() = user_id);


-- ==========================================
-- Migration: 00000000000009_automations.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0006_automations.sql
-- Task automation engine: user-defined recurring AI workflows.
--
-- Each automation hands a natural-language instruction to the orchestrator
-- headlessly on a schedule (hourly/daily/weekly) and records every
-- execution in automation_runs. (trigger_type 'event' is reserved for the
-- next iteration — reply/intent-driven runs.)
--
-- ADDITIVE + IDEMPOTENT: create-if-not-exists tables/indexes, drop-then-
-- create policies. No-op on a database already at this shape.
-- =====================================================================

create table if not exists public.automations (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  name text not null,
  instruction text not null,
  trigger_type text not null default 'schedule' check (trigger_type in ('schedule','event')),
  schedule_frequency text check (schedule_frequency in ('hourly','daily','weekly')),
  schedule_hour smallint not null default 9 check (schedule_hour between 0 and 23),
  schedule_dow smallint not null default 1 check (schedule_dow between 0 and 6),
  trigger_event text,
  status text not null default 'active' check (status in ('active','paused')),
  last_run_at timestamptz,
  next_run_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.automation_runs (
  id uuid primary key default gen_random_uuid(),
  automation_id uuid not null references public.automations(id) on delete cascade,
  user_id uuid not null references public.users(id) on delete cascade,
  trigger text not null default 'schedule',
  status text not null default 'running' check (status in ('running','completed','failed')),
  summary text,
  error text,
  started_at timestamptz not null default now(),
  finished_at timestamptz
);

create index if not exists automations_due_idx
  on public.automations(status, next_run_at);
create index if not exists automations_user_idx
  on public.automations(user_id, created_at desc);
create index if not exists automation_runs_automation_idx
  on public.automation_runs(automation_id, started_at desc);

alter table public.automations enable row level security;
alter table public.automation_runs enable row level security;

drop policy if exists "own automations" on public.automations;
create policy "own automations" on public.automations
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

drop policy if exists "own automation runs" on public.automation_runs;
create policy "own automation runs" on public.automation_runs
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ==========================================
-- Migration: 00000000000010_whatsapp_notifications.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0007_whatsapp_notifications.sql
-- WhatsApp alert preferences on the user row. India/SEA SMBs respond on
-- WhatsApp far faster than email, so key events (automation finished, hot
-- reply) can ping the user's WhatsApp when they opt in.
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

alter table public.users
  add column if not exists whatsapp_number text;

alter table public.users
  add column if not exists notify_whatsapp boolean not null default false;


-- ==========================================
-- Migration: 00000000000011_outreach_language.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0008_outreach_language.sql
-- Preferred drafting language for outbound copy. Lets India/SEA sellers
-- generate first-touch emails in Hindi, Hinglish, Tamil, etc. — not just
-- English. Default 'English' preserves current behaviour.
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

alter table public.users
  add column if not exists outreach_language text not null default 'English';


-- ==========================================
-- Migration: 00000000000012_dpdp.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0009_dpdp.sql
-- India DPDP Act 2026 — right-to-erasure audit trail. Logs each data
-- subject request (erasure/access) the user actions, with how many
-- prospect rows were removed, for the 7-day-erasure + accountability
-- obligations.
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

create table if not exists public.data_subject_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  email_hash text not null,
  type text not null default 'erasure' check (type in ('erasure', 'access')),
  status text not null default 'completed' check (status in ('pending', 'completed', 'failed')),
  prospects_erased integer not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists dsr_user_idx
  on public.data_subject_requests(user_id, created_at desc);

alter table public.data_subject_requests enable row level security;

drop policy if exists "own dsr" on public.data_subject_requests;
create policy "own dsr" on public.data_subject_requests
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);


-- ==========================================
-- Migration: 00000000000013_razorpay_subscriptions.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0010_razorpay_subscriptions.sql
-- Razorpay Subscriptions / UPI AutoPay — recurring billing. Stores the
-- active subscription id + status on the user. The one-time order path
-- (payment.captured) is unaffected; this is purely additive.
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

alter table public.users
  add column if not exists razorpay_subscription_id text;

alter table public.users
  add column if not exists subscription_status text;


-- ==========================================
-- Migration: 00000000000014_whatsapp_outreach.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0011_whatsapp_outreach.sql
-- WhatsApp as a first-class OUTREACH channel (Phase 3b).
--
-- WhatsApp is the highest-response B2B channel in India/SEA, but cold
-- WhatsApp outreach is policy-gated: business-initiated messages must use
-- a pre-approved template, the recipient must be reachable by phone, and
-- STOP / UNSUBSCRIBE replies must immediately suppress further sends.
--
-- This migration adds the minimum schema to make that real:
--   - prospects.phone               — E.164-ish digits (no +); nullable
--   - prospects.whatsapp_opted_in   — explicit positive consent (rare on
--                                     cold; reserved for opt-in funnels)
--   - prospects.whatsapp_opted_out  — STOP / UNSUBSCRIBE received via
--                                     the inbound webhook
--   - campaign_recipients.channel   — 'email' | 'whatsapp'; default 'email'
--                                     so every existing row stays correct
--
-- ADDITIVE + IDEMPOTENT. No drops, no rename, no data migration.
-- =====================================================================

alter table public.prospects
  add column if not exists phone text;

alter table public.prospects
  add column if not exists whatsapp_opted_in boolean not null default false;

alter table public.prospects
  add column if not exists whatsapp_opted_out boolean not null default false;

create index if not exists prospects_phone_idx
  on public.prospects(phone)
  where phone is not null;

alter table public.campaign_recipients
  add column if not exists channel text not null default 'email';

-- Drop the previous CHECK if it was added in an earlier run so we can
-- re-create it cleanly; harmless if the constraint never existed.
alter table public.campaign_recipients
  drop constraint if exists campaign_recipients_channel_check;

alter table public.campaign_recipients
  add constraint campaign_recipients_channel_check
  check (channel in ('email', 'whatsapp'));

create index if not exists campaign_recipients_channel_idx
  on public.campaign_recipients(user_id, channel, status);


-- ==========================================
-- Migration: 00000000000015_push_tokens.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0012_push_tokens.sql
-- Push notification registration (Phase 6 mobile prerequisite).
--
-- Per docs/MOBILE.md: the mobile app (Expo/RN) and the future web push
-- pipeline both need a per-user device-token store the backend can
-- read when raising hot-reply or automation-completion alerts.
--
-- Today this table feeds the /api/extension/push-register endpoint
-- only. The "push-fire" step (insert into reply_classifications /
-- automation_runs → push) is wired in a later migration when the
-- mobile client lands.
--
-- ADDITIVE + IDEMPOTENT. RLS: user owns rows.
-- =====================================================================

create table if not exists public.push_tokens (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null references public.users(id) on delete cascade,
  token         text not null,
  provider      text not null check (provider in ('expo', 'web')),
  platform      text check (platform in ('ios', 'android', 'web')),
  device_id     text,
  created_at    timestamptz not null default now(),
  last_seen_at  timestamptz not null default now(),
  unique (user_id, token)
);

create index if not exists push_tokens_user_idx
  on public.push_tokens(user_id);

alter table public.push_tokens enable row level security;

-- Idempotent policy creation: drop if it exists, then create.
drop policy if exists "push_tokens own select" on public.push_tokens;
create policy "push_tokens own select"
  on public.push_tokens
  for select
  using (auth.uid() = user_id);

drop policy if exists "push_tokens own insert" on public.push_tokens;
create policy "push_tokens own insert"
  on public.push_tokens
  for insert
  with check (auth.uid() = user_id);

drop policy if exists "push_tokens own update" on public.push_tokens;
create policy "push_tokens own update"
  on public.push_tokens
  for update
  using (auth.uid() = user_id)
  with check (auth.uid() = user_id);

drop policy if exists "push_tokens own delete" on public.push_tokens;
create policy "push_tokens own delete"
  on public.push_tokens
  for delete
  using (auth.uid() = user_id);


-- ==========================================
-- Migration: 00000000000016_slack_notifications.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0013_slack_notifications.sql
-- Third notification channel: Slack incoming webhook.
--
-- Per-user opt-in. The webhook URL is treated as a secret — store
-- only; never log. Pipes the same alert events as WhatsApp + push:
-- automation completion (success + failure), hot replies.
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

alter table public.users
  add column if not exists slack_webhook_url text;

alter table public.users
  add column if not exists notify_slack boolean not null default false;


-- ==========================================
-- Migration: 00000000000017_reply_wants_meeting.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0014_reply_wants_meeting.sql
-- Persist the wants_meeting boolean the classifier emits (v0.9).
--
-- Today the classifier returns wants_meeting alongside the category
-- but it's discarded at insert time (the cron only stored category,
-- confidence, snippet, needs_human, handled). With this migration:
--   - the cron stores wants_meeting
--   - /api/extension/alerts can emit it in the alert meta payload
--   - the Inbox UI can surface a "Book a meeting" CTA on rows where
--     wants_meeting=true
--   - the agent's draft_reply handler can read it without a re-classify
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

alter table public.reply_classifications
  add column if not exists wants_meeting boolean not null default false;

-- Partial index for the common Inbox query: "show me hot replies that
-- want a meeting, that I haven't handled". Tiny — only matches the
-- rows we care about.
create index if not exists reply_classifications_meeting_idx
  on public.reply_classifications(user_id, created_at desc)
  where needs_human = true and handled = false and wants_meeting = true;


-- ==========================================
-- Migration: 00000000000018_user_calendar_url.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0015_user_calendar_url.sql
-- Per-user calendar booking URL (Calendly / Cal.com / SavvyCal / Vyte).
--
-- Used by the agent's draft_reply tool: when the inbound reply has
-- wants_meeting=true, the drafted response pastes the user's real
-- calendar URL instead of the placeholder [calendar link]. Real
-- usability win — every hot-reply draft is one click closer to a
-- booked meeting.
--
-- The column is nullable; absent it the tool falls back to the old
-- "Wed/Thu 3-5pm IST?" verbal proposal so existing flows still work.
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

alter table public.users
  add column if not exists calendar_url text;


-- ==========================================
-- Migration: 00000000000019_campaign_mailbox_rotation.sql
-- ==========================================

-- =====================================================================
-- LeadGenAI — 0016_campaign_mailbox_rotation.sql
-- Multi-mailbox sender rotation for a campaign.
--
-- Today every campaign sends from a single mailbox (campaigns.mailbox_id).
-- Real cold-outbound teams connect 3-10 mailboxes and rotate to keep
-- per-mailbox volume low + reputation healthy (Instantly/Smartlead's
-- killer feature).
--
-- When mailbox_rotation=true, the send-due cron picks the user's
-- least-loaded active mailbox each tick (self-balancing round-robin
-- via ORDER BY daily_sent ASC). When false (default), the legacy
-- behaviour stands: one mailbox per campaign.
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

alter table public.campaigns
  add column if not exists mailbox_rotation boolean not null default false;

