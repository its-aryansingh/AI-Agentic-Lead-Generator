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
