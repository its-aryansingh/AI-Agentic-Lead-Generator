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
