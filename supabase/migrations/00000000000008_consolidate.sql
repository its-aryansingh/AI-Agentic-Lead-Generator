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
