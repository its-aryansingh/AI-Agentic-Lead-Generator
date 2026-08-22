-- =====================================================================
-- LeadGenAI — 0016_campaign_mailbox_rotation.sql
-- Multi-mailbox sender rotation for a campaign.
--
-- Today every campaign sends from a single mailbox (campaigns.mailbox_id).
-- Real cold-outbound teams connect 3-10 mailboxes and rotate to keep
-- per-mailbox volume low + reputation healthy (Instantly/Smartlead's
-- killer feature).
--
-- When mailbox_rotation=true, the send-due cron picks the user's
-- least-loaded active mailbox each tick (self-balancing round-robin
-- via ORDER BY daily_sent ASC). When false (default), the legacy
-- behaviour stands: one mailbox per campaign.
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

alter table public.campaigns
  add column if not exists mailbox_rotation boolean not null default false;
