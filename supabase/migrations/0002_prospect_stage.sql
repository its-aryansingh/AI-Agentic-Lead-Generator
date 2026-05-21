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
