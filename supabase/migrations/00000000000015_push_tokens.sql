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
