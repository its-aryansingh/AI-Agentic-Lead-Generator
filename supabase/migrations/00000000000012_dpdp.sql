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
