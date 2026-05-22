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
