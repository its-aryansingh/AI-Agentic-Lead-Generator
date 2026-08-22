-- =====================================================================
-- LeadGenAI — 0011_whatsapp_outreach.sql
-- WhatsApp as a first-class OUTREACH channel (Phase 3b).
--
-- WhatsApp is the highest-response B2B channel in India/SEA, but cold
-- WhatsApp outreach is policy-gated: business-initiated messages must use
-- a pre-approved template, the recipient must be reachable by phone, and
-- STOP / UNSUBSCRIBE replies must immediately suppress further sends.
--
-- This migration adds the minimum schema to make that real:
--   - prospects.phone               — E.164-ish digits (no +); nullable
--   - prospects.whatsapp_opted_in   — explicit positive consent (rare on
--                                     cold; reserved for opt-in funnels)
--   - prospects.whatsapp_opted_out  — STOP / UNSUBSCRIBE received via
--                                     the inbound webhook
--   - campaign_recipients.channel   — 'email' | 'whatsapp'; default 'email'
--                                     so every existing row stays correct
--
-- ADDITIVE + IDEMPOTENT. No drops, no rename, no data migration.
-- =====================================================================

alter table public.prospects
  add column if not exists phone text;

alter table public.prospects
  add column if not exists whatsapp_opted_in boolean not null default false;

alter table public.prospects
  add column if not exists whatsapp_opted_out boolean not null default false;

create index if not exists prospects_phone_idx
  on public.prospects(phone)
  where phone is not null;

alter table public.campaign_recipients
  add column if not exists channel text not null default 'email';

-- Drop the previous CHECK if it was added in an earlier run so we can
-- re-create it cleanly; harmless if the constraint never existed.
alter table public.campaign_recipients
  drop constraint if exists campaign_recipients_channel_check;

alter table public.campaign_recipients
  add constraint campaign_recipients_channel_check
  check (channel in ('email', 'whatsapp'));

create index if not exists campaign_recipients_channel_idx
  on public.campaign_recipients(user_id, channel, status);
