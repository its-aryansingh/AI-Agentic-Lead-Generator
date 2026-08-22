-- =====================================================================
-- LeadGenAI — 0010_razorpay_subscriptions.sql
-- Razorpay Subscriptions / UPI AutoPay — recurring billing. Stores the
-- active subscription id + status on the user. The one-time order path
-- (payment.captured) is unaffected; this is purely additive.
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

alter table public.users
  add column if not exists razorpay_subscription_id text;

alter table public.users
  add column if not exists subscription_status text;
