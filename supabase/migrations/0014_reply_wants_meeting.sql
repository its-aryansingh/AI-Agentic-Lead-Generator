-- =====================================================================
-- LeadGenAI — 0014_reply_wants_meeting.sql
-- Persist the wants_meeting boolean the classifier emits (v0.9).
--
-- Today the classifier returns wants_meeting alongside the category
-- but it's discarded at insert time (the cron only stored category,
-- confidence, snippet, needs_human, handled). With this migration:
--   - the cron stores wants_meeting
--   - /api/extension/alerts can emit it in the alert meta payload
--   - the Inbox UI can surface a "Book a meeting" CTA on rows where
--     wants_meeting=true
--   - the agent's draft_reply handler can read it without a re-classify
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

alter table public.reply_classifications
  add column if not exists wants_meeting boolean not null default false;

-- Partial index for the common Inbox query: "show me hot replies that
-- want a meeting, that I haven't handled". Tiny — only matches the
-- rows we care about.
create index if not exists reply_classifications_meeting_idx
  on public.reply_classifications(user_id, created_at desc)
  where needs_human = true and handled = false and wants_meeting = true;
