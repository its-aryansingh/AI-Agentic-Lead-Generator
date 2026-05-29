-- =====================================================================
-- LeadGenAI — 0015_user_calendar_url.sql
-- Per-user calendar booking URL (Calendly / Cal.com / SavvyCal / Vyte).
--
-- Used by the agent's draft_reply tool: when the inbound reply has
-- wants_meeting=true, the drafted response pastes the user's real
-- calendar URL instead of the placeholder [calendar link]. Real
-- usability win — every hot-reply draft is one click closer to a
-- booked meeting.
--
-- The column is nullable; absent it the tool falls back to the old
-- "Wed/Thu 3-5pm IST?" verbal proposal so existing flows still work.
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

alter table public.users
  add column if not exists calendar_url text;
