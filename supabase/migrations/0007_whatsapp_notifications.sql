-- =====================================================================
-- LeadGenAI — 0007_whatsapp_notifications.sql
-- WhatsApp alert preferences on the user row. India/SEA SMBs respond on
-- WhatsApp far faster than email, so key events (automation finished, hot
-- reply) can ping the user's WhatsApp when they opt in.
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

alter table public.users
  add column if not exists whatsapp_number text;

alter table public.users
  add column if not exists notify_whatsapp boolean not null default false;
