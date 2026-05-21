-- =====================================================================
-- LeadGenAI — 0002_sequences_sending.sql
-- Adds sequences, sending, and reply-classification tables required by
-- the v0.6 UI pages (sequences, pipeline, inbox, mailboxes, analytics).
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
-- campaigns — a single send of a sequence to a group of prospects
-- ---------------------------------------------------------------------
create table if not exists public.campaigns (
  id          uuid primary key default gen_random_uuid(),
  user_id     uuid not null references public.users(id) on delete cascade,
  sequence_id uuid references public.sequences(id) on delete set null,
  name        text not null,
  status      text not null default 'draft'
    check (status in ('draft', 'running', 'paused', 'completed')),
  created_at  timestamptz not null default now()
);
create index if not exists campaigns_user_idx
  on public.campaigns(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- campaign_recipients — per-prospect send record (pipeline rows)
-- Carries user_id directly so RLS doesn't need a multi-hop join.
-- ---------------------------------------------------------------------
create table if not exists public.campaign_recipients (
  id          uuid primary key default gen_random_uuid(),
  campaign_id uuid not null references public.campaigns(id) on delete cascade,
  user_id     uuid not null references public.users(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete set null,
  email       text,
  subject     text,
  status      text not null default 'scheduled'
    check (status in ('scheduled', 'sent', 'opened', 'replied', 'bounced', 'unsubscribed')),
  sent_at     timestamptz,
  reply_at    timestamptz,
  created_at  timestamptz not null default now()
);
create index if not exists campaign_recipients_user_idx
  on public.campaign_recipients(user_id, created_at desc);
create index if not exists campaign_recipients_campaign_idx
  on public.campaign_recipients(campaign_id, status);

-- ---------------------------------------------------------------------
-- reply_classifications — AI-classified inbound replies
-- Carries user_id directly for RLS.
-- ---------------------------------------------------------------------
create table if not exists public.reply_classifications (
  id           uuid primary key default gen_random_uuid(),
  recipient_id uuid not null references public.campaign_recipients(id) on delete cascade,
  user_id      uuid not null references public.users(id) on delete cascade,
  category     text not null
    check (category in ('interested', 'question', 'objection', 'unsubscribe', 'out_of_office', 'other')),
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
-- mailboxes — connected Gmail sending accounts
-- ---------------------------------------------------------------------
create table if not exists public.mailboxes (
  id                   uuid primary key default gen_random_uuid(),
  user_id              uuid not null references public.users(id) on delete cascade,
  email_address        text not null,
  provider             text not null default 'gmail'
    check (provider in ('gmail')),
  status               text not null default 'active'
    check (status in ('active', 'paused', 'disconnected')),
  oauth_refresh_token  text,
  daily_sent           int  not null default 0,
  daily_send_limit     int  not null default 10,
  warmup_started_at    timestamptz not null default now(),
  physical_address     text,
  created_at           timestamptz not null default now(),
  unique (user_id, email_address)
);
create index if not exists mailboxes_user_idx
  on public.mailboxes(user_id, created_at desc);

-- ---------------------------------------------------------------------
-- Row-Level Security — same pattern as 0001_init.sql
-- Service-role key bypasses RLS for server-side workers.
-- ---------------------------------------------------------------------
alter table public.sequences             enable row level security;
alter table public.sequence_steps        enable row level security;
alter table public.sequence_enrollments  enable row level security;
alter table public.campaigns             enable row level security;
alter table public.campaign_recipients   enable row level security;
alter table public.reply_classifications enable row level security;
alter table public.mailboxes             enable row level security;

-- sequences — owner full access
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

-- campaigns — owner full access
drop policy if exists "own campaigns" on public.campaigns;
create policy "own campaigns" on public.campaigns
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- campaign_recipients — user_id column for fast RLS
drop policy if exists "own campaign recipients" on public.campaign_recipients;
create policy "own campaign recipients" on public.campaign_recipients
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- reply_classifications — user_id column for fast RLS
drop policy if exists "own reply classifications" on public.reply_classifications;
create policy "own reply classifications" on public.reply_classifications
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- mailboxes — owner full access
drop policy if exists "own mailboxes" on public.mailboxes;
create policy "own mailboxes" on public.mailboxes
  for all using (auth.uid() = user_id) with check (auth.uid() = user_id);

-- ---------------------------------------------------------------------
-- Trigger: reset mailbox daily_sent counter at midnight UTC
-- (worker can call this; Supabase cron or pg_cron also works)
-- ---------------------------------------------------------------------
create or replace function public.reset_mailbox_daily_sent()
returns void language plpgsql security definer as $$
begin
  update public.mailboxes set daily_sent = 0;
end $$;
