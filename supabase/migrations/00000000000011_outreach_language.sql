-- =====================================================================
-- LeadGenAI — 0008_outreach_language.sql
-- Preferred drafting language for outbound copy. Lets India/SEA sellers
-- generate first-touch emails in Hindi, Hinglish, Tamil, etc. — not just
-- English. Default 'English' preserves current behaviour.
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

alter table public.users
  add column if not exists outreach_language text not null default 'English';
