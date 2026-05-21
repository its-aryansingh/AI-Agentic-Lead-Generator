-- =====================================================================
-- LeadGenAI — 0002_sequences_sending.sql
-- Adds sequences, sending pipeline, and reply-classification tables
-- required by the v0.6 UI pages and cron workers.
-- Idempotent: safe to re-run.
--
-- Apply with:  supabase db push
--          or  psql $DATABASE_URL -f supabase/migrations/0002_sequences_sending.sql
-- =====================================================================

-- ---------------------------------------------------------------------
-- sequences — multi-step outreach cadences owned by a user
-- ---------------------------------------------------------------------
create table if not exists public.sequences (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  name        text not null,
  description text,
  is_active   boolean not null default true,
  created_at  timestamptz not null default now()
);
create index if not exists sequences_user_idx
  on public.sequences(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- sequence_steps — ordered steps within a sequence
-- ---------------------------------------------------------------------
create table if not exists public.sequence_steps (
  id               uuid primary key default gen_random_uuid(),
  sequence_id      uuid not null references public.sequences(id) on delete cascade,
  step_order       int  not null,
  day_offset       int  not null default 0,
  channel          text not null default 'email'
    check (channel in ('email', 'linkedin_dm', 'task')),
  subject_template text,
  body_template    text not null,
  created_at       timestamptz not null default now(),
  unique (sequence_id, step_order)
);
create index if not exists sequence_steps_seq_idx
  on public.sequence_steps(sequence_id, step_order);

-- ---------------------------------------------------------------------
-- sequence_enrollments — prospects enrolled in a sequence
-- ---------------------------------------------------------------------
create table if not exists public.sequence_enrollments (
  id           uuid primary key default gen_random_uuid(),
  sequence_id  uuid not null references public.sequences(id) on delete cascade,
  prospect_id  uuid references public.prospects(id) on delete set null,
  status       text not null default 'active'
    check (status in ('active', 'completed', 'paused', 'unsubscribed', 'bounced')),
  current_step int  not null default 0,
  enrolled_at  timestamptz not null default now(),
  created_at   timestamptz not null default now()
);
create index if not exists sequence_enrollments_seq_idx
  on public.sequence_enrollments(sequence_id, status);
create index if not exists sequence_enrollments_prospect_idx
  on public.sequence_enrollments(prospect_id);

-- ---------------------------------------------------------------------
-- mailboxes — connected Gmail sending accounts
-- ---------------------------------------------------------------------
create table if not exists public.mailboxes (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  email_address       text not null,
  provider            text not null default 'gmail'
    check (provider in ('gmail')),
  status              text not null default 'active'
    check (status in ('active', 'paused', 'disconnected')),
  oauth_refresh_token text,
  daily_sent          int  not null default 0,
  daily_send_limit    int  not null default 10,
  last_reset_at       timestamptz not null default now(),
  warmup_started_at   timestamptz not null default now(),
  physical_address    text,
  created_at          timestamptz not null default now(),
  unique (user_id, email_address)
);
create index if not exists mailboxes_user_idx
  on public.mailboxes(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- campaigns — a send run of a sequence to a group of prospects.
-- send_window_start/end_hour are UTC hours (0-23).
-- ---------------------------------------------------------------------
create table if not exists public.campaigns (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null references public.users(id) on delete cascade,
  mailbox_id             uuid references public.mailboxes(id) on delete set null,
  sequence_id            uuid references public.sequences(id) on delete set null,
  name                   text not null,
  status                 text not null default 'draft'
    check (status in ('draft', 'active', 'paused', 'completed')),
  daily_cap              int  not null default 30,
  send_window_start_hour int  not null default 9,
  send_window_end_hour   int  not null default 17,
  created_at             timestamptz not null default now()
);
create index if not exists campaigns_user_idx
  on public.campaigns(user_id, created_at desc);
create index if not exists campaigns_active_idx
  on public.campaigns(status)
  where status = 'active';

-- ---------------------------------------------------------------------
-- campaign_recipients — per-prospect send record (pipeline rows).
-- user_id is denormalized for fast RLS without a multi-hop join.
-- thread_id is used by the reply-detection cron to match inbound mail.
-- ---------------------------------------------------------------------
create table if not exists public.campaign_recipients (
  id           uuid primary key default gen_random_uuid(),
  campaign_id  uuid not null references public.campaigns(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  prospect_id  uuid references public.prospects(id) on delete set null,
  email        text,
  subject      text,
  body         text,
  status       text not null default 'scheduled'
    check (status in ('scheduled', 'sent', 'opened', 'replied',
                      'bounced', 'unsubscribed', 'skipped', 'failed')),
  scheduled_for timestamptz,
  sent_at      timestamptz,
  reply_at     timestamptz,
  message_id   text,
  thread_id    text,
  bounce_reason text,
  created_at   timestamptz not null default now()
);
create index if not exists campaign_recipients_user_idx
  on public.campaign_recipients(user_id, created_at desc);
create index if not exists campaign_recipients_campaign_idx
  on public.campaign_recipients(campaign_id, status);
create index if not exists campaign_recipients_thread_idx
  on public.campaign_recipients(thread_id)
  where thread_id is not null;
create index if not exists campaign_recipients_due_idx
  on public.campaign_recipients(scheduled_for)
  where status = 'scheduled';

-- ---------------------------------------------------------------------
-- reply_classifications — AI-classified inbound replies.
-- user_id is denormalized for fast RLS (avoids 3-table join on reads).
-- ---------------------------------------------------------------------
create table if not exists public.reply_classifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.campaign_recipients(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  category     text not null
    check (category in ('interested', 'question', 'objection',
                        'unsubscribe', 'out_of_office', 'not_interested', 'other')),
  confidence   numeric(4, 3),
  snippet      text,
  needs_human  boolean not null default false,
  handled      boolean not null default false,
  created_at   timestamptz not null default now()
);
create index if not exists reply_classifications_user_idx
  on public.reply_classifications(user_id, created_at desc)
  where needs_human = true and handled = false;
create index if not exists reply_classifications_recipient_idx
  on public.reply_classifications(recipient_id);

-- ---------------------------------------------------------------------
-- suppressions — global per-user unsubscribe / bounce list.
-- Keyed by sha256(email) so we never store raw addresses here.
-- ---------------------------------------------------------------------
create table if not exists public.suppressions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  email_hash text not null,
  reason     text not null default 'unsubscribed'
    check (reason in ('unsubscribed', 'bounced', 'manual')),
  created_at timestamptz not null default now(),
  unique (user_id, email_hash)
);
create index if not exists suppressions_lookup_idx
  on public.suppressions(user_id, email_hash);

-- ---------------------------------------------------------------------
-- email_events — append-only event log for analytics + audit.
-- Carries user_id for RLS; payload is open jsonb for flexibility.
-- ---------------------------------------------------------------------
create table if not exists public.email_events (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.campaign_recipients(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  event_type   text not null
    check (event_type in ('sent', 'opened', 'replied', 'bounced',
                          'unsubscribed', 'auto_reply', 'failed', 'skipped')),
  payload      jsonb,
  created_at   timestamptz not null default now()
);
create index if not exists email_events_recipient_idx
  on public.email_events(recipient_id, created_at desc);
create index if not exists email_events_user_idx
  on public.email_events(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- intent_watches — keyword queries the cron polls every hour
-- sources is an array of provider slugs: hn_algolia, github
-- ---------------------------------------------------------------------
create table if not exists public.intent_watches (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  query      text not null,
  sources    text[] not null default array['hn_algolia', 'github'],
  created_at timestamptz not null default now()
);
create index if not exists intent_watches_user_idx
  on public.intent_watches(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- intent_triggers — matches surfaced by the poll-intent cron
-- dismissed = true means the user has seen and cleared it
-- ---------------------------------------------------------------------
create table if not exists public.intent_triggers (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  watch_id       uuid references public.intent_watches(id) on delete set null,
  trigger_type   text not null,
  account_name   text,
  account_domain text,
  payload        jsonb,
  source_url     text,
  occurred_at    timestamptz not null default now(),
  dismissed      boolean not null default false,
  created_at     timestamptz not null default now()
);
create index if not exists intent_triggers_user_idx
  on public.intent_triggers(user_id, occurred_at desc)
  where dismissed = false;

-- ---------------------------------------------------------------------
-- Row-Level Security — same pattern as 0001_init.sql.
-- Service-role key bypasses RLS for cron workers.
-- ---------------------------------------------------------------------
alter table public.sequences             enable row level security;
alter table public.sequence_steps        enable row level security;
alter table public.sequence_enrollments  enable row level security;
alter table public.mailboxes             enable row level security;
alter table public.campaigns             enable row level security;
alter table public.campaign_recipients   enable row level security;
alter table public.reply_classifications enable row level security;
alter table public.suppressions          enable row level security;
alter table public.email_events          enable row level security;
alter table public.intent_watches        enable row level security;
alter table public.intent_triggers       enable row level security;

-- sequences
drop policy if exists "own sequences" on public.sequences;
create policy "own sequences" on public.sequences
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- sequence_steps — scoped through parent sequence
drop policy if exists "own sequence steps" on public.sequence_steps;
create policy "own sequence steps" on public.sequence_steps
  for all using (
    exists (
      select 1 from public.sequences s
       where s.id = sequence_steps.sequence_id and s.user_id = auth.uid()
    )
  );

-- sequence_enrollments — scoped through parent sequence
drop policy if exists "own sequence enrollments" on public.sequence_enrollments;
create policy "own sequence enrollments" on public.sequence_enrollments
  for all using (
    exists (
      select 1 from public.sequences s
       where s.id = sequence_enrollments.sequence_id and s.user_id = auth.uid()
    )
  );

-- mailboxes
drop policy if exists "own mailboxes" on public.mailboxes;
create policy "own mailboxes" on public.mailboxes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- campaigns
drop policy if exists "own campaigns" on public.campaigns;
create policy "own campaigns" on public.campaigns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- campaign_recipients — user_id column for O(1) RLS
drop policy if exists "own campaign recipients" on public.campaign_recipients;
create policy "own campaign recipients" on public.campaign_recipients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- reply_classifications — user_id column for O(1) RLS
drop policy if exists "own reply classifications" on public.reply_classifications;
create policy "own reply classifications" on public.reply_classifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- suppressions
drop policy if exists "own suppressions" on public.suppressions;
create policy "own suppressions" on public.suppressions
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- email_events — read-only for users; cron writes via service role
drop policy if exists "own email events" on public.email_events;
create policy "own email events" on public.email_events
  for select using (auth.uid() = user_id);

-- intent_watches
drop policy if exists "own intent watches" on public.intent_watches;
create policy "own intent watches" on public.intent_watches
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- intent_triggers
drop policy if exists "own intent triggers" on public.intent_triggers;
create policy "own intent triggers" on public.intent_triggers
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Helper: reset mailbox daily_sent counters (call from pg_cron or cron route)
-- ---------------------------------------------------------------------
create or replace function public.reset_mailbox_daily_sent()
returns void language plpgsql security definer as $$
begin
  update public.mailboxes
     set daily_sent = 0, last_reset_at = now()
   where date_trunc('day', last_reset_at at time zone 'UTC')
       < date_trunc('day', now() at time zone 'UTC');
end $$;
