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
