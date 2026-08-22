-- =====================================================================
-- LeadGenAI — 0013_slack_notifications.sql
-- Third notification channel: Slack incoming webhook.
--
-- Per-user opt-in. The webhook URL is treated as a secret — store
-- only; never log. Pipes the same alert events as WhatsApp + push:
-- automation completion (success + failure), hot replies.
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

alter table public.users
  add column if not exists slack_webhook_url text;

alter table public.users
  add column if not exists notify_slack boolean not null default false;
