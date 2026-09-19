-- =====================================================================
-- 0004_salesengai_phase8.sql — Railway PostgreSQL
--
-- PORTED from 21 SalesEngAIMVP migrations, 20260903000100_voice_lifecycle
-- through 20260909000100_campaign_timezone_compatibility. Together they
-- are the voice lifecycle, autonomous outreach, CRM pull, unified lead
-- handoff and Phase 8 safety hardening work.
--
-- As in 0003, two classes of Supabase-ism are removed — 67 statements in
-- total: every `enable row level security` and every policy, all of
-- which called auth.uid(). Ownership lives in lib/db/rls.ts instead.
-- Not one auth.uid() survives in a function body; all 28 were on policy
-- lines, so nothing here had to be rewritten, only deleted.
--
-- THE ONE STRUCTURAL CHANGE WORTH READING BEFORE YOU RUN THIS
--
-- 20260906000100_autonomous_outreach adds public.prospects.user_id,
-- backfills it from jobs, and makes it NOT NULL. Almost everything after
-- it depends on the composite key prospects(id, user_id) to pin a child
-- row to one tenant in the database rather than in application code.
--
-- That changes how prospects are owned. Until now lib/db/rls.ts filtered
-- prospects through a join to jobs; from here it filters on the column,
-- which is both tighter and cheaper, and matches the policy this
-- migration's own `create policy "own prospects"` declared. rls.ts is
-- updated in the same commit — the two must move together.
--
-- The backfill raises rather than proceeding if any prospect has no job
-- to inherit an owner from. That is deliberate: a NULL user_id on a
-- NOT NULL column is a failed migration, but a wrong one is a
-- cross-tenant leak.
--
-- DELIBERATELY NOT PORTED
--
-- 20260906000200_public_contact_enrichment. It defines its own
-- public.enrichment_runs with a different shape to the one 0001 already
-- created here — status values, column names and token counters all
-- differ — and its foreign key is prospects(id, user_id), which did not
-- exist when that table was written. LeadGenAI keeps its own enrichment
-- engine (crawler.service, run-service, validator,
-- complete_enrichment_run), so taking SalesEngAIMVP's schema for the
-- same job would leave two half-wired pipelines. Nothing else in these
-- 21 migrations references it — it is a leaf.
--
-- A third Supabase-ism had to be fixed rather than deleted: Supabase
-- installs pgcrypto into an `extensions` schema, so three statements
-- called extensions.digest(...) to hash emails and phone numbers. On
-- Railway, `create extension pgcrypto` (0000) puts digest() in public,
-- so the schema qualifier is dropped. Left as-is it fails with
-- 'schema "extensions" does not exist' partway through, which on a
-- migration this size means a half-applied schema.
--
-- A fourth Supabase-ism, and the one with teeth: 21 statements of
--     revoke all on function public.X(...) from public, anon, authenticated;
--     grant execute on function public.X(...) to service_role;
-- anon / authenticated / service_role are PostgREST roles. They do not
-- exist on Railway and the statements fail outright, so they are removed
-- here. But what they expressed is real: these functions move money,
-- claim work and reserve calls, and a signed-in user was never allowed
-- to call them directly.
--
-- On Railway every query runs as one database user, so the database can
-- no longer make that distinction and the application must. SERVICE_ONLY_RPC
-- in lib/db/rls.ts carries the same list, and lib/supabase/server.ts
-- refuses those functions to a user-scoped client. Add a function here and
-- you must add it there.
--
-- Run order: 0000 → 0001 → 0002 → 0003 → 0004
-- =====================================================================

-- ---------------------------------------------------------------------
-- 20260903000100_voice_lifecycle.sql
-- ---------------------------------------------------------------------

-- Voice lifecycle states needed for durable finalization and human-reviewed retry.
alter table public.voice_executions
  drop constraint if exists voice_executions_status_check;

alter table public.voice_executions
  add constraint voice_executions_status_check
  check (status in (
    'queued', 'in_progress', 'finalizing', 'completed', 'failed', 'cancelled'
  ));

alter table public.prospects
  drop constraint if exists prospects_next_action_check;

alter table public.prospects
  add constraint prospects_next_action_check
  check (next_action in (
    'review', 'research', 'draft_email', 'send_email', 'call', 'follow_up',
    'human_handoff', 'push_to_crm', 'none', 'qualify', 'await_reply',
    'sequence_step', 'draft_reply', 'human_review', 'review_call_outcome',
    'follow_up_call', 'book_meeting'
  ));

-- ---------------------------------------------------------------------
-- 20260903000200_temporal_voice_cutover.sql
-- ---------------------------------------------------------------------

-- Per-customer Temporal voice cutover and immutable compliance receipts.
alter table public.voice_connections
  add column if not exists temporal_enabled boolean not null default false;

alter table public.voice_executions
  add column if not exists temporal_workflow_id text,
  add column if not exists temporal_run_id text;

create unique index if not exists voice_executions_temporal_workflow_idx
  on public.voice_executions(temporal_workflow_id)
  where temporal_workflow_id is not null;

create table if not exists public.voice_compliance_decisions (
  id uuid primary key,
  user_id uuid not null references public.users(id) on delete cascade,
  voice_execution_id uuid not null references public.voice_executions(id) on delete cascade,
  check_sequence int not null check (check_sequence > 0),
  verdict text not null check (verdict in ('ALLOW', 'BLOCK', 'DEFER', 'ESCALATE')),
  reason text,
  policy_version text not null,
  retry_after timestamptz,
  evidence jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  unique(voice_execution_id, check_sequence)
);

create or replace function public.prevent_voice_compliance_decision_mutation()
returns trigger language plpgsql as $$
begin
  raise exception 'voice compliance decisions are immutable';
end;
$$;

drop trigger if exists voice_compliance_decisions_immutable
  on public.voice_compliance_decisions;
create trigger voice_compliance_decisions_immutable
  before update or delete on public.voice_compliance_decisions
  for each row execute function public.prevent_voice_compliance_decision_mutation();

-- ---------------------------------------------------------------------
-- 20260903000300_voice_agent_configuration.sql
-- ---------------------------------------------------------------------

-- Aravya-owned voice-agent configuration. Recording/telecom policy fields are
-- intentionally excluded until the required legal review is complete.
alter table public.voice_connections
  add column if not exists agent_management_mode text not null default 'external',
  add column if not exists default_language text not null default 'en',
  add column if not exists max_call_seconds int not null default 180,
  add column if not exists max_turns int not null default 12,
  add column if not exists max_objection_attempts int not null default 1,
  add column if not exists human_transfer_phone text,
  add column if not exists agent_config_version int not null default 1,
  add column if not exists agent_config_synced_at timestamptz,
  add column if not exists agent_config_error text;

alter table public.voice_connections
  drop constraint if exists voice_connections_agent_management_mode_check,
  drop constraint if exists voice_connections_default_language_check,
  drop constraint if exists voice_connections_max_call_seconds_check,
  drop constraint if exists voice_connections_max_turns_check,
  drop constraint if exists voice_connections_max_objection_attempts_check;

alter table public.voice_connections
  add constraint voice_connections_agent_management_mode_check
    check (agent_management_mode in ('external', 'managed')),
  add constraint voice_connections_default_language_check
    check (default_language in ('en', 'hi', 'hinglish')),
  add constraint voice_connections_max_call_seconds_check
    check (max_call_seconds between 30 and 300),
  add constraint voice_connections_max_turns_check
    check (max_turns between 2 and 30),
  add constraint voice_connections_max_objection_attempts_check
    check (max_objection_attempts between 0 and 2);

-- ---------------------------------------------------------------------
-- 20260904000100_voice_agent_extended_options.sql
-- ---------------------------------------------------------------------

-- Additive extended voice agent configuration options for Bolna and future voice providers.
alter table public.voice_connections
  add column if not exists agent_options jsonb not null default '{}'::jsonb;

-- ---------------------------------------------------------------------
-- 20260905000100_voice_reconciliation.sql
-- ---------------------------------------------------------------------

-- Durable bookkeeping for provider reconciliation when a webhook is delayed or lost.
alter table public.voice_executions
  add column if not exists reconciliation_attempts int not null default 0,
  add column if not exists last_reconciled_at timestamptz,
  add column if not exists reconciliation_error text,
  add column if not exists reconciliation_alerted_at timestamptz;

alter table public.voice_executions
  drop constraint if exists voice_executions_reconciliation_attempts_check;

alter table public.voice_executions
  add constraint voice_executions_reconciliation_attempts_check
  check (reconciliation_attempts >= 0);

create index if not exists voice_executions_reconciliation_idx
  on public.voice_executions(updated_at)
  where status in ('queued', 'in_progress', 'finalizing');

-- ---------------------------------------------------------------------
-- 20260905000200_voice_provider_inventory.sql
-- ---------------------------------------------------------------------

-- Persist the verified origin of a customer-selected outbound caller ID.
alter table public.voice_connections
  add column if not exists from_phone_provider text,
  add column if not exists from_phone_source text,
  add column if not exists from_phone_verified_at timestamptz;

alter table public.voice_connections
  drop constraint if exists voice_connections_from_phone_source_check;

alter table public.voice_connections
  add constraint voice_connections_from_phone_source_check
  check (from_phone_source is null or from_phone_source in ('account', 'sip_trunk'));

-- ---------------------------------------------------------------------
-- 20260905000300_voice_action_ledger.sql
-- ---------------------------------------------------------------------

-- Idempotent ledger for voice-agent actions that can mutate external state.
alter table public.voice_connections
  add column if not exists booking_link_url text;

create table if not exists public.voice_action_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid not null references public.voice_connections(id) on delete cascade,
  execution_id uuid not null references public.voice_executions(id) on delete cascade,
  prospect_id uuid references public.prospects(id) on delete set null,
  action_kind text not null check (action_kind in (
    'ASK_QUESTION', 'ANSWER', 'SCHEDULE_CALLBACK', 'BOOK_MEETING',
    'TRANSFER_HUMAN', 'SEND_INFORMATION', 'END_CALL'
  )),
  idempotency_key text not null,
  provider_tool_call_id text,
  arguments jsonb not null default '{}'::jsonb,
  confirmation_evidence text,
  status text not null default 'requested' check (status in (
    'requested', 'confirmation_required', 'confirmed', 'executing',
    'succeeded', 'failed', 'rejected'
  )),
  result jsonb,
  failure_reason text,
  requested_at timestamptz not null default now(),
  confirmed_at timestamptz,
  started_at timestamptz,
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (connection_id, idempotency_key)
);

create unique index if not exists voice_action_provider_tool_call_idx
  on public.voice_action_requests(connection_id, provider_tool_call_id)
  where provider_tool_call_id is not null;

create index if not exists voice_action_execution_idx
  on public.voice_action_requests(execution_id, requested_at desc);

-- ---------------------------------------------------------------------
-- 20260905000400_voice_live_transfer.sql
-- ---------------------------------------------------------------------

-- Availability-gated live transfer policy and provider outcome receipts.
alter table public.voice_connections
  add column if not exists transfer_enabled boolean not null default false,
  add column if not exists transfer_start_hour int not null default 9,
  add column if not exists transfer_end_hour int not null default 18,
  add column if not exists transfer_timezone text not null default 'Asia/Kolkata',
  add column if not exists transfer_weekdays int[] not null default array[1,2,3,4,5],
  add column if not exists transfer_fallback text not null default 'schedule_callback';

alter table public.voice_connections
  drop constraint if exists voice_connections_transfer_hours_check,
  drop constraint if exists voice_connections_transfer_weekdays_check,
  drop constraint if exists voice_connections_transfer_fallback_check;

alter table public.voice_connections
  add constraint voice_connections_transfer_hours_check
    check (
      transfer_start_hour between 0 and 23
      and transfer_end_hour between 1 and 24
      and transfer_end_hour > transfer_start_hour
    ),
  add constraint voice_connections_transfer_weekdays_check
    check (
      cardinality(transfer_weekdays) between 1 and 7
      and transfer_weekdays <@ array[1,2,3,4,5,6,7]
    ),
  add constraint voice_connections_transfer_fallback_check
    check (transfer_fallback in ('schedule_callback', 'human_review', 'end_call'));

alter table public.voice_action_requests
  add column if not exists provider_status_code int,
  add column if not exists provider_success boolean;

-- ---------------------------------------------------------------------
-- 20260905000500_calendar_booking.sql
-- ---------------------------------------------------------------------

-- Least-privilege calendar connection used by confirmed voice meeting actions.
create table if not exists public.calendar_connections (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  provider text not null default 'google' check (provider in ('google')),
  status text not null default 'active' check (status in ('active', 'reconnect_required', 'disconnected')),
  account_email text not null,
  encrypted_refresh_token text not null,
  calendar_id text not null default 'primary',
  calendar_timezone text not null default 'Asia/Kolkata',
  meeting_title text not null default 'Introduction call',
  meeting_duration_minutes int not null default 30 check (meeting_duration_minutes between 15 and 120),
  availability_start_hour int not null default 9,
  availability_end_hour int not null default 18,
  availability_weekdays int[] not null default array[1,2,3,4,5],
  slot_increment_minutes int not null default 30 check (slot_increment_minutes in (15, 30, 60)),
  buffer_minutes int not null default 15 check (buffer_minutes between 0 and 120),
  last_verified_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, provider),
  constraint calendar_connections_hours_check check (
    availability_start_hour between 0 and 23
    and availability_end_hour between 1 and 24
    and availability_end_hour > availability_start_hour
  ),
  constraint calendar_connections_weekdays_check check (
    cardinality(availability_weekdays) between 1 and 7
    and availability_weekdays <@ array[1,2,3,4,5,6,7]
  )
);

create index if not exists calendar_connections_active_idx
  on public.calendar_connections(user_id, status);

-- ---------------------------------------------------------------------
-- 20260906000100_autonomous_outreach.sql
-- ---------------------------------------------------------------------

-- Delivery Phase 1: tenant ownership, canonical identity, approvals, and
-- atomic platform-credit charging.  This migration is additive only.
create extension if not exists pgcrypto;

-- Direct ownership is backfilled exclusively from the required job relation.
alter table public.prospects add column if not exists user_id uuid references public.users(id) on delete cascade;
update public.prospects p set user_id = j.user_id from public.jobs j
 where p.job_id = j.id and p.user_id is null;
do $$ begin
  if exists (select 1 from public.prospects where user_id is null) then
    raise exception 'Cannot make prospects.user_id NOT NULL: orphaned prospects require explicit remediation';
  end if;
end $$;
alter table public.prospects alter column user_id set not null;

alter table public.prospects
  add column if not exists normalized_email text,
  add column if not exists normalized_phone text,
  add column if not exists normalized_phone_e164 text,
  add column if not exists email_hash text,
  add column if not exists phone_hash text,
  add column if not exists identity_normalization_version integer not null default 1,
  add column if not exists source_provider text,
  add column if not exists source_record_id text,
  add column if not exists source_modified_at timestamptz,
  add column if not exists last_contacted_at timestamptz,
  add column if not exists last_engaged_at timestamptz,
  add column if not exists status_updated_at timestamptz not null default now();

-- Historical values are normalized conservatively: local phone numbers are
-- never assigned a country code. New values are generated in server code.
update public.prospects
   set normalized_email = lower(trim(email)),
       email_hash = encode(digest(convert_to(lower(trim(email)), 'UTF8'), 'sha256'), 'hex')
 where email is not null and email ~* '^[^[:space:]@]+@[^[:space:]@]+\.[^[:space:]@]+$'
   and normalized_email is null;
update public.prospects
   set normalized_phone = regexp_replace(trim(phone), '[[:space:]().-]', '', 'g'),
       normalized_phone_e164 = regexp_replace(trim(phone), '[[:space:]().-]', '', 'g')
 where phone is not null
   and regexp_replace(trim(phone), '[[:space:]().-]', '', 'g') ~ '^\+[1-9][0-9]{7,14}$'
   and normalized_phone is null;
update public.prospects
   set phone_hash = encode(digest(convert_to(normalized_phone, 'UTF8'), 'sha256'), 'hex')
 where normalized_phone is not null and phone_hash is null;

-- Existing duplicate prospects are retained for provenance.  A deterministic
-- canonical row (earliest created, then UUID) keeps the identity key; later
-- rows retain their raw contact data but cannot defeat future tenant dedupe.
with ranked as (
  select id, row_number() over (partition by user_id, email_hash order by created_at, id) as position
  from public.prospects where email_hash is not null
) update public.prospects p set email_hash = null
  from ranked where p.id = ranked.id and ranked.position > 1;
with ranked as (
  select id, row_number() over (partition by user_id, phone_hash order by created_at, id) as position
  from public.prospects where phone_hash is not null
) update public.prospects p set phone_hash = null
  from ranked where p.id = ranked.id and ranked.position > 1;
with ranked as (
  select id, row_number() over (partition by user_id, source_provider, source_record_id order by created_at, id) as position
  from public.prospects where source_provider is not null and source_record_id is not null
) update public.prospects p set source_provider = null, source_record_id = null, source_modified_at = null
  from ranked where p.id = ranked.id and ranked.position > 1;

create unique index if not exists prospects_id_user_id_key on public.prospects(id, user_id);
create index if not exists prospects_user_created_idx on public.prospects(user_id, created_at desc);
create index if not exists prospects_user_status_idx on public.prospects(user_id, lead_status, next_action_at);
create unique index if not exists prospects_user_email_hash_key on public.prospects(user_id, email_hash) where email_hash is not null;
create unique index if not exists prospects_user_phone_hash_key on public.prospects(user_id, phone_hash) where phone_hash is not null;
create unique index if not exists prospects_user_source_record_key on public.prospects(user_id, source_provider, source_record_id)
 where source_provider is not null and source_record_id is not null;

alter table public.jobs drop constraint if exists jobs_input_source_check;
alter table public.jobs add constraint jobs_input_source_check check (input_source in ('chat_search','chat_enrich','csv_upload','manual_entry','crm_pull'));

-- Persist a scoped, expiring approval. The confirmation token is stored only
-- as a hash; metadata that defines the scope is immutable after creation.
create table if not exists public.outreach_action_approvals (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  session_id uuid references public.chat_sessions(id) on delete set null,
  action_kind text not null,
  channel text not null check (channel in ('email','voice','multichannel')),
  scope jsonb not null,
  preview_summary jsonb not null default '{}'::jsonb,
  payload_hash text not null,
  confirmation_token_hash text not null,
  source text not null check (source in ('ui','chat','api')),
  actor text not null,
  consent_attestation jsonb,
  override_reason text,
  approved_at timestamptz not null default now(),
  expires_at timestamptz,
  confirmed_at timestamptz,
  consumed_at timestamptz,
  audit_metadata jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  check (expires_at is null or expires_at > approved_at),
  check (consumed_at is null or confirmed_at is not null)
);
create index if not exists outreach_action_approvals_user_idx on public.outreach_action_approvals(user_id, created_at desc);
create unique index if not exists outreach_action_approvals_one_use_token_idx
 on public.outreach_action_approvals(user_id, confirmation_token_hash);

create or replace function public.prevent_approval_scope_mutation()
returns trigger language plpgsql as $$
begin
  if new.user_id is distinct from old.user_id or new.session_id is distinct from old.session_id
     or new.action_kind is distinct from old.action_kind or new.channel is distinct from old.channel
     or new.scope is distinct from old.scope or new.preview_summary is distinct from old.preview_summary
     or new.payload_hash is distinct from old.payload_hash
     or new.confirmation_token_hash is distinct from old.confirmation_token_hash
     or new.source is distinct from old.source or new.actor is distinct from old.actor
     or new.consent_attestation is distinct from old.consent_attestation
     or new.override_reason is distinct from old.override_reason
     or new.approved_at is distinct from old.approved_at
     or new.audit_metadata is distinct from old.audit_metadata then
    raise exception 'Approval scope and audit metadata are immutable';
  end if;
  return new;
end $$;
drop trigger if exists trg_approval_immutable_scope on public.outreach_action_approvals;
create trigger trg_approval_immutable_scope before update on public.outreach_action_approvals
 for each row execute function public.prevent_approval_scope_mutation();

-- Tenant composite keys: these FKs stop a service-role mistake from linking
-- a child row to another tenant's parent even though RLS is bypassed.
-- MADE IDEMPOTENT during the port. `add constraint` has no IF NOT
-- EXISTS, so re-running the original aborted here with
-- "relation voice_connections_id_user_key already exists" and left the
-- rest of this file unapplied. A migration this size has to be safe to
-- re-run after a partial failure. The guard is the same DO block
-- SalesEngAIMVP itself started using for the later constraints.
do $$
declare
  t text;
begin
  foreach t in array array[
    'voice_connections','voice_executions','campaigns',
    'campaign_recipients','crm_connections'
  ] loop
    if not exists (
      select 1 from pg_constraint
      where conname = t || '_id_user_key'
        and conrelid = ('public.' || t)::regclass
    ) then
      execute format(
        'alter table public.%I add constraint %I unique (id, user_id)',
        t, t || '_id_user_key');
    end if;
  end loop;
end $$;
alter table public.voice_executions drop constraint if exists voice_executions_owned_prospect_fkey;
alter table public.voice_executions add constraint voice_executions_owned_prospect_fkey foreign key (prospect_id, user_id) references public.prospects(id, user_id) on delete cascade;
alter table public.voice_executions drop constraint if exists voice_executions_owned_connection_fkey;
alter table public.voice_executions add constraint voice_executions_owned_connection_fkey foreign key (connection_id, user_id) references public.voice_connections(id, user_id) on delete cascade;
alter table public.lead_qualification_facts drop constraint if exists lead_qualification_facts_owned_prospect_fkey;
alter table public.lead_qualification_facts add constraint lead_qualification_facts_owned_prospect_fkey foreign key (prospect_id, user_id) references public.prospects(id, user_id) on delete cascade;
alter table public.crm_syncs drop constraint if exists crm_syncs_owned_prospect_fkey;
alter table public.crm_syncs add constraint crm_syncs_owned_prospect_fkey foreign key (prospect_id, user_id) references public.prospects(id, user_id) on delete cascade;
alter table public.crm_syncs drop constraint if exists crm_syncs_owned_connection_fkey;
alter table public.crm_syncs add constraint crm_syncs_owned_connection_fkey foreign key (connection_id, user_id) references public.crm_connections(id, user_id) on delete cascade;
alter table public.campaign_recipients drop constraint if exists campaign_recipients_owned_prospect_fkey;
alter table public.campaign_recipients add constraint campaign_recipients_owned_prospect_fkey foreign key (prospect_id, user_id) references public.prospects(id, user_id) on delete cascade;
alter table public.campaign_recipients drop constraint if exists campaign_recipients_owned_campaign_fkey;
alter table public.campaign_recipients add constraint campaign_recipients_owned_campaign_fkey foreign key (campaign_id, user_id) references public.campaigns(id, user_id) on delete cascade;

-- Atomic, idempotent SalesEngAI credit deduction. Provider costs do not call
-- this function; it is for platform AI/orchestration credit operations only.
alter table public.credit_transactions add column if not exists idempotency_key text;
create unique index if not exists credit_transactions_user_idempotency_key
 on public.credit_transactions(user_id, idempotency_key) where idempotency_key is not null;

create or replace function public.deduct_credits_atomic(
  p_user_id uuid, p_amount integer, p_reason text, p_job_id uuid default null,
  p_idempotency_key text default null
) returns table(ok boolean, remaining integer, error text, transaction_id uuid)
language plpgsql security definer set search_path = public as $$
declare v_remaining integer; v_existing uuid;
begin
  if p_amount <= 0 then return query select false, 0, 'Credit amount must be positive.', null::uuid; return; end if;
  if p_idempotency_key is null or length(trim(p_idempotency_key)) = 0 then
    return query select false, 0, 'An idempotency key is required.', null::uuid; return;
  end if;
  select id into v_existing from public.credit_transactions
   where user_id = p_user_id and idempotency_key = p_idempotency_key;
  if v_existing is not null then
    select credits_remaining into v_remaining from public.users where id = p_user_id;
    return query select true, coalesce(v_remaining, 0), null::text, v_existing; return;
  end if;
  select credits_remaining into v_remaining from public.users where id = p_user_id for update;
  if v_remaining is null then return query select false, 0, 'User not found.', null::uuid; return; end if;
  if v_remaining < p_amount then return query select false, v_remaining, 'Insufficient credits.', null::uuid; return; end if;
  update public.users set credits_remaining = credits_remaining - p_amount where id = p_user_id;
  insert into public.credit_transactions(user_id, delta, reason, job_id, idempotency_key)
   values (p_user_id, -p_amount, p_reason, p_job_id, p_idempotency_key) returning id into v_existing;
  return query select true, v_remaining - p_amount, null::text, v_existing;
end $$;

-- ---------------------------------------------------------------------
-- 20260906000300_crm_pull.sql
-- ---------------------------------------------------------------------

-- Delivery Phase 2: durable, tenant-owned CRM contact pulls.
create unique index if not exists jobs_id_user_id_key on public.jobs(id, user_id);
create table if not exists public.crm_pull_runs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid not null,
  job_id uuid references public.jobs(id) on delete set null,
  provider text not null check (provider in ('hubspot','zoho')),
  status text not null check (status in ('preview','running','completed','partial','failed')),
  modified_after timestamptz,
  cursor text,
  next_cursor text,
  fetched_count integer not null default 0,
  inserted_count integer not null default 0,
  updated_count integer not null default 0,
  unchanged_count integer not null default 0,
  skipped_count integer not null default 0,
  invalid_count integer not null default 0,
  failed_count integer not null default 0,
  error text,
  row_errors jsonb not null default '[]'::jsonb,
  created_at timestamptz not null default now(),
  started_at timestamptz,
  completed_at timestamptz,
  unique(id, user_id),
  foreign key (connection_id, user_id) references public.crm_connections(id, user_id) on delete cascade,
  foreign key (job_id, user_id) references public.jobs(id, user_id) on delete set null
);
create index if not exists crm_pull_runs_user_created_idx on public.crm_pull_runs(user_id, created_at desc);

create table if not exists public.prospect_crm_links (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  connection_id uuid not null,
  prospect_id uuid not null,
  provider_record_id text not null,
  provider_modified_at timestamptz,
  payload_checksum text not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique(connection_id, provider_record_id),
  unique(connection_id, prospect_id),
  foreign key (connection_id, user_id) references public.crm_connections(id, user_id) on delete cascade,
  foreign key (prospect_id, user_id) references public.prospects(id, user_id) on delete cascade
);
create index if not exists prospect_crm_links_user_idx on public.prospect_crm_links(user_id, connection_id);

-- A confirmation can create exactly one job/run.  Row locking makes double
-- clicks and transport retries harmless before the provider is contacted.
create or replace function public.begin_crm_pull_run(
  p_user_id uuid, p_confirmation_hash text, p_connection_id uuid, p_provider text,
  p_modified_after timestamptz default null, p_cursor text default null
) returns table(job_id uuid, run_id uuid)
language plpgsql security definer set search_path = public as $$
declare v_approval outreach_action_approvals%rowtype; v_job uuid; v_run uuid;
begin
  select * into v_approval from outreach_action_approvals
   where user_id=p_user_id and action_kind='crm_pull' and confirmation_token_hash=p_confirmation_hash for update;
  if not found or v_approval.consumed_at is not null or (v_approval.expires_at is not null and v_approval.expires_at <= now()) then
    raise exception 'CRM preview confirmation is invalid or has expired. Preview again.';
  end if;
  if v_approval.scope->>'connectionId' is distinct from p_connection_id::text or v_approval.scope->>'provider' is distinct from p_provider then
    raise exception 'CRM import differs from the preview. Preview again.';
  end if;
  insert into jobs(user_id,input_source,status,prospect_count) values(p_user_id,'crm_pull','processing',0) returning id into v_job;
  insert into crm_pull_runs(user_id,connection_id,job_id,provider,status,modified_after,cursor,started_at)
    values(p_user_id,p_connection_id,v_job,p_provider,'running',p_modified_after,p_cursor,now()) returning id into v_run;
  update outreach_action_approvals set confirmed_at=now(), consumed_at=now() where id=v_approval.id;
  return query select v_job,v_run;
end $$;

-- Serializes each row's deterministic match/link/update. Existing non-null
-- prospect contact fields are intentionally retained: imported CRM data must
-- never overwrite a user edit. A connection link is the strongest identity.
create or replace function public.apply_crm_pull_contact(
  p_user_id uuid, p_connection_id uuid, p_job_id uuid, p_provider text,
  p_record_id text, p_first_name text, p_last_name text, p_company text,
  p_title text, p_email text, p_phone text, p_normalized_email text,
  p_normalized_phone text, p_email_hash text, p_phone_hash text,
  p_modified_at timestamptz, p_checksum text
) returns table(prospect_id uuid, outcome text)
language plpgsql security definer set search_path = public as $$
declare v_prospect uuid; v_outcome text; v_name text;
begin
  if not exists (select 1 from crm_connections where id=p_connection_id and user_id=p_user_id and provider=p_provider and status='active') then
    raise exception 'CRM connection is not active or is not owned by this user';
  end if;
  select prospect_id into v_prospect from prospect_crm_links where connection_id=p_connection_id and provider_record_id=p_record_id for update;
  if v_prospect is not null then v_outcome := 'unchanged'; end if;
  if v_prospect is null and p_email_hash is not null then
    select id into v_prospect from prospects where user_id=p_user_id and email_hash=p_email_hash for update;
    if v_prospect is not null then v_outcome := 'updated'; end if;
  end if;
  if v_prospect is null and p_phone_hash is not null then
    select id into v_prospect from prospects where user_id=p_user_id and phone_hash=p_phone_hash for update;
    if v_prospect is not null then v_outcome := 'updated'; end if;
  end if;
  if v_prospect is null then
    v_name := nullif(trim(concat_ws(' ', p_first_name, p_last_name)), '');
    if v_name is null then v_name := coalesce(p_email, p_phone, 'CRM contact'); end if;
    insert into prospects(job_id,user_id,input_source,input_name,input_company,input_title,email,phone,email_source,email_confidence,status,lead_status,next_action,normalized_email,normalized_phone,normalized_phone_e164,email_hash,phone_hash,identity_normalization_version,source_provider,source_record_id,source_modified_at)
      values(p_job_id,p_user_id,'crm',v_name,p_company,p_title,p_email,p_phone,case when p_email is null then 'none' else 'extracted' end,'unknown','pending','new','review',p_normalized_email,p_normalized_phone,p_normalized_phone,p_email_hash,p_phone_hash,1,p_provider,p_record_id,p_modified_at)
      returning id into v_prospect;
    v_outcome := 'created';
  elsif v_outcome = 'updated' then
    update prospects set
      input_name=coalesce(input_name,nullif(trim(concat_ws(' ',p_first_name,p_last_name)),'')), input_company=coalesce(input_company,p_company), input_title=coalesce(input_title,p_title),
      email=coalesce(email,p_email), phone=coalesce(phone,p_phone), normalized_email=coalesce(normalized_email,p_normalized_email), normalized_phone=coalesce(normalized_phone,p_normalized_phone), normalized_phone_e164=coalesce(normalized_phone_e164,p_normalized_phone), email_hash=coalesce(email_hash,p_email_hash), phone_hash=coalesce(phone_hash,p_phone_hash), source_modified_at=coalesce(greatest(source_modified_at,p_modified_at),source_modified_at,p_modified_at)
    where id=v_prospect and user_id=p_user_id;
  end if;
  insert into prospect_crm_links(user_id,connection_id,prospect_id,provider_record_id,provider_modified_at,payload_checksum)
    values(p_user_id,p_connection_id,v_prospect,p_record_id,p_modified_at,p_checksum)
    on conflict(connection_id,provider_record_id) do update set provider_modified_at=excluded.provider_modified_at,payload_checksum=excluded.payload_checksum,updated_at=now();
  return query select v_prospect, v_outcome;
end $$;

-- ---------------------------------------------------------------------
-- 20260906000400_fix_crm_pull_function.sql
-- ---------------------------------------------------------------------

-- Correct the Phase 2 CRM pull RPC after live verification. The output column
-- named prospect_id shadows an unqualified link-table column in PL/pgSQL.
create or replace function public.apply_crm_pull_contact(
  p_user_id uuid, p_connection_id uuid, p_job_id uuid, p_provider text,
  p_record_id text, p_first_name text, p_last_name text, p_company text,
  p_title text, p_email text, p_phone text, p_normalized_email text,
  p_normalized_phone text, p_email_hash text, p_phone_hash text,
  p_modified_at timestamptz, p_checksum text
) returns table(prospect_id uuid, outcome text)
language plpgsql security definer set search_path = public as $$
declare v_prospect uuid; v_outcome text; v_name text;
begin
  if not exists (select 1 from crm_connections where id=p_connection_id and user_id=p_user_id and provider=p_provider and status='active') then
    raise exception 'CRM connection is not active or is not owned by this user';
  end if;
  select link.prospect_id into v_prospect from prospect_crm_links link where link.connection_id=p_connection_id and link.provider_record_id=p_record_id for update;
  if v_prospect is not null then v_outcome := 'unchanged'; end if;
  if v_prospect is null and p_email_hash is not null then
    select id into v_prospect from prospects where user_id=p_user_id and email_hash=p_email_hash for update;
    if v_prospect is not null then v_outcome := 'updated'; end if;
  end if;
  if v_prospect is null and p_phone_hash is not null then
    select id into v_prospect from prospects where user_id=p_user_id and phone_hash=p_phone_hash for update;
    if v_prospect is not null then v_outcome := 'updated'; end if;
  end if;
  if v_prospect is null then
    v_name := nullif(trim(concat_ws(' ', p_first_name, p_last_name)), '');
    if v_name is null then v_name := coalesce(p_email, p_phone, 'CRM contact'); end if;
    insert into prospects(job_id,user_id,input_source,input_name,input_company,input_title,email,phone,email_source,email_confidence,status,lead_status,next_action,normalized_email,normalized_phone,normalized_phone_e164,email_hash,phone_hash,identity_normalization_version,source_provider,source_record_id,source_modified_at)
      values(p_job_id,p_user_id,'crm',v_name,p_company,p_title,p_email,p_phone,case when p_email is null then 'none' else 'extracted' end,'unknown','pending','new','review',p_normalized_email,p_normalized_phone,p_normalized_phone,p_email_hash,p_phone_hash,1,p_provider,p_record_id,p_modified_at)
      returning id into v_prospect;
    v_outcome := 'created';
  elsif v_outcome = 'updated' then
    update prospects set
      input_name=coalesce(input_name,nullif(trim(concat_ws(' ',p_first_name,p_last_name)),'')), input_company=coalesce(input_company,p_company), input_title=coalesce(input_title,p_title),
      email=coalesce(email,p_email), phone=coalesce(phone,p_phone), normalized_email=coalesce(normalized_email,p_normalized_email), normalized_phone=coalesce(normalized_phone,p_normalized_phone), normalized_phone_e164=coalesce(normalized_phone_e164,p_normalized_phone), email_hash=coalesce(email_hash,p_email_hash), phone_hash=coalesce(phone_hash,p_phone_hash), source_modified_at=coalesce(greatest(source_modified_at,p_modified_at),source_modified_at,p_modified_at)
    where id=v_prospect and user_id=p_user_id;
  end if;
  insert into prospect_crm_links(user_id,connection_id,prospect_id,provider_record_id,provider_modified_at,payload_checksum)
    values(p_user_id,p_connection_id,v_prospect,p_record_id,p_modified_at,p_checksum)
    on conflict(connection_id,provider_record_id) do update set provider_modified_at=excluded.provider_modified_at,payload_checksum=excluded.payload_checksum,updated_at=now();
  return query select v_prospect, v_outcome;
end $$;

-- ---------------------------------------------------------------------
-- 20260906000500_skip_conflicting_crm_link.sql
-- ---------------------------------------------------------------------

-- A connection permits one canonical provider mapping per prospect. A later
-- provider record that hashes to that prospect is safely skipped, preserving
-- the original mapping and preventing duplicates.
create or replace function public.apply_crm_pull_contact(
  p_user_id uuid, p_connection_id uuid, p_job_id uuid, p_provider text,
  p_record_id text, p_first_name text, p_last_name text, p_company text,
  p_title text, p_email text, p_phone text, p_normalized_email text,
  p_normalized_phone text, p_email_hash text, p_phone_hash text,
  p_modified_at timestamptz, p_checksum text
) returns table(prospect_id uuid, outcome text)
language plpgsql security definer set search_path = public as $$
declare v_prospect uuid; v_outcome text; v_name text;
begin
  if not exists (select 1 from crm_connections where id=p_connection_id and user_id=p_user_id and provider=p_provider and status='active') then raise exception 'CRM connection is not active or is not owned by this user'; end if;
  select link.prospect_id into v_prospect from prospect_crm_links link where link.connection_id=p_connection_id and link.provider_record_id=p_record_id for update;
  if v_prospect is not null then v_outcome := 'unchanged'; end if;
  if v_prospect is null and p_email_hash is not null then select id into v_prospect from prospects where user_id=p_user_id and email_hash=p_email_hash for update; if v_prospect is not null then v_outcome := 'updated'; end if; end if;
  if v_prospect is null and p_phone_hash is not null then select id into v_prospect from prospects where user_id=p_user_id and phone_hash=p_phone_hash for update; if v_prospect is not null then v_outcome := 'updated'; end if; end if;
  if v_prospect is not null and v_outcome = 'updated' and exists (select 1 from prospect_crm_links link where link.connection_id=p_connection_id and link.prospect_id=v_prospect) then return query select v_prospect, 'skipped'::text; return; end if;
  if v_prospect is null then
    v_name := nullif(trim(concat_ws(' ', p_first_name, p_last_name)), ''); if v_name is null then v_name := coalesce(p_email, p_phone, 'CRM contact'); end if;
    insert into prospects(job_id,user_id,input_source,input_name,input_company,input_title,email,phone,email_source,email_confidence,status,lead_status,next_action,normalized_email,normalized_phone,normalized_phone_e164,email_hash,phone_hash,identity_normalization_version,source_provider,source_record_id,source_modified_at)
      values(p_job_id,p_user_id,'crm',v_name,p_company,p_title,p_email,p_phone,case when p_email is null then 'none' else 'extracted' end,'unknown','pending','new','review',p_normalized_email,p_normalized_phone,p_normalized_phone,p_email_hash,p_phone_hash,1,p_provider,p_record_id,p_modified_at) returning id into v_prospect;
    v_outcome := 'created';
  elsif v_outcome = 'updated' then
    update prospects set input_name=coalesce(input_name,nullif(trim(concat_ws(' ',p_first_name,p_last_name)),'')), input_company=coalesce(input_company,p_company), input_title=coalesce(input_title,p_title), email=coalesce(email,p_email), phone=coalesce(phone,p_phone), normalized_email=coalesce(normalized_email,p_normalized_email), normalized_phone=coalesce(normalized_phone,p_normalized_phone), normalized_phone_e164=coalesce(normalized_phone_e164,p_normalized_phone), email_hash=coalesce(email_hash,p_email_hash), phone_hash=coalesce(phone_hash,p_phone_hash), source_modified_at=coalesce(greatest(source_modified_at,p_modified_at),source_modified_at,p_modified_at) where id=v_prospect and user_id=p_user_id;
  end if;
  insert into prospect_crm_links(user_id,connection_id,prospect_id,provider_record_id,provider_modified_at,payload_checksum) values(p_user_id,p_connection_id,v_prospect,p_record_id,p_modified_at,p_checksum) on conflict(connection_id,provider_record_id) do update set provider_modified_at=excluded.provider_modified_at,payload_checksum=excluded.payload_checksum,updated_at=now();
  return query select v_prospect, v_outcome;
end $$;

-- ---------------------------------------------------------------------
-- 20260906000600_autonomous_outreach_dispatch.sql
-- ---------------------------------------------------------------------

-- Delivery Phase 3: durable autonomous outreach runs, items, schedules and lead events.
create table if not exists public.outreach_schedules (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  name text not null, timezone text not null, local_time time not null, weekdays smallint[] not null,
  channel_strategy text not null check (channel_strategy in ('email','voice','smart_both','sequence')),
  lead_filter jsonb not null default '{}'::jsonb, sequence jsonb not null default '[]'::jsonb,
  approval_id uuid references public.outreach_action_approvals(id) on delete set null,
  status text not null default 'active' check (status in ('active','paused','disabled')),
  idempotency_seed text not null, next_run_at timestamptz, last_run_at timestamptz, last_occurrence_key text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(id,user_id), unique(user_id,idempotency_seed)
);
create table if not exists public.outreach_runs (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  schedule_id uuid, triggered_by text not null check (triggered_by in ('ui','chat','schedule','api','system')),
  channel_strategy text not null check (channel_strategy in ('email','voice','smart_both','sequence')),
  status text not null default 'pending' check (status in ('pending','running','completed','partial','failed','cancelled')),
  lead_filter jsonb not null default '{}'::jsonb, config_snapshot jsonb not null default '{}'::jsonb,
  approval_id uuid not null references public.outreach_action_approvals(id), idempotency_key text not null,
  requested_count integer not null default 0, claimed_count integer not null default 0, completed_count integer not null default 0,
  skipped_count integer not null default 0, failed_count integer not null default 0, platform_credits_charged integer not null default 0,
  error text, created_at timestamptz not null default now(), started_at timestamptz, completed_at timestamptz,
  unique(id,user_id), unique(user_id,idempotency_key),
  foreign key(schedule_id,user_id) references public.outreach_schedules(id,user_id) on delete set null
);
create table if not exists public.outreach_run_items (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  run_id uuid not null, prospect_id uuid not null, channel text not null check(channel in ('email','voice')),
  step_order integer not null default 0, status text not null default 'pending' check(status in ('pending','claimed','queued','scheduled','completed','skipped','failed','cancelled')),
  scheduled_for timestamptz, claimed_at timestamptz, completed_at timestamptz, campaign_recipient_id uuid,
  voice_execution_id uuid, skip_reason text, error text, attempts integer not null default 0, idempotency_key text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(run_id,prospect_id,channel,step_order), unique(user_id,idempotency_key),
  foreign key(run_id,user_id) references public.outreach_runs(id,user_id) on delete cascade,
  foreign key(prospect_id,user_id) references public.prospects(id,user_id) on delete cascade,
  foreign key(campaign_recipient_id,user_id) references public.campaign_recipients(id,user_id) on delete set null,
  foreign key(voice_execution_id,user_id) references public.voice_executions(id,user_id) on delete set null
);
create table if not exists public.lead_state_events (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  prospect_id uuid not null, event_type text not null, from_status text, to_status text, actor text not null,
  source text not null, source_id uuid, metadata jsonb not null default '{}'::jsonb, created_at timestamptz not null default now(),
  foreign key(prospect_id,user_id) references public.prospects(id,user_id) on delete cascade
);
create table if not exists public.lead_followups (
  id uuid primary key default gen_random_uuid(), user_id uuid not null references public.users(id) on delete cascade,
  prospect_id uuid not null, channel text not null check(channel in ('email','voice')), scheduled_at timestamptz not null,
  timezone text not null, note text, status text not null default 'scheduled' check(status in ('scheduled','completed','cancelled','failed')),
  created_by text not null, idempotency_key text not null, created_at timestamptz not null default now(), completed_at timestamptz,
  unique(user_id,idempotency_key), foreign key(prospect_id,user_id) references public.prospects(id,user_id) on delete cascade
);
create index if not exists outreach_runs_user_status_idx on public.outreach_runs(user_id,status,created_at desc);
create index if not exists outreach_items_claim_idx on public.outreach_run_items(status,scheduled_for) where status in ('pending','scheduled');
create index if not exists outreach_schedules_due_idx on public.outreach_schedules(status,next_run_at) where status='active';
create index if not exists lead_state_events_user_prospect_idx on public.lead_state_events(user_id,prospect_id,created_at desc);
-- The claiming update is deliberately one statement: parallel workers cannot execute an item twice.
create or replace function public.claim_outreach_items(p_user_id uuid,p_run_id uuid,p_limit integer default 50)
returns setof public.outreach_run_items language sql security definer set search_path=public as $$
  with claimable as (select id from public.outreach_run_items where user_id=p_user_id and run_id=p_run_id and status in ('pending','scheduled') and (scheduled_for is null or scheduled_for<=now()) order by step_order,id for update skip locked limit p_limit)
  update public.outreach_run_items i set status='claimed',claimed_at=now(),attempts=i.attempts+1,updated_at=now() from claimable c where i.id=c.id returning i.*;
$$;

-- ---------------------------------------------------------------------
-- 20260906000700_voice_person_call_guard.sql
-- ---------------------------------------------------------------------

-- Delivery Phase 4: durable per-person voice reservations and approved overrides.
-- The partial unique index is the provider-launch guard; it is intentionally
-- tenant scoped so identical numbers owned by different tenants are isolated.
alter table public.voice_executions
  add column if not exists recipient_phone_hash text,
  add column if not exists counts_toward_call_limit boolean not null default true,
  add column if not exists is_override boolean not null default false,
  add column if not exists override_reason text,
  add column if not exists override_authorized_by uuid references public.users(id),
  add column if not exists override_authorized_at timestamptz,
  add column if not exists override_of_execution_id uuid references public.voice_executions(id),
  add column if not exists action_approval_id uuid references public.outreach_action_approvals(id),
  add column if not exists request_idempotency_key text,
  add column if not exists attempt_number integer,
  add column if not exists reservation_state text not null default 'reserved';

alter table public.voice_executions
  drop constraint if exists voice_execution_override_reason_check,
  add constraint voice_execution_override_reason_check check (
    (is_override = false and override_reason is null and override_authorized_by is null
      and override_authorized_at is null and override_of_execution_id is null and action_approval_id is null)
    or
    (is_override = true and length(trim(override_reason)) >= 10
      and override_authorized_by is not null and override_authorized_at is not null
      and override_of_execution_id is not null and action_approval_id is not null)
  ),
  drop constraint if exists voice_execution_attempt_number_check,
  add constraint voice_execution_attempt_number_check check (attempt_number is null or attempt_number > 0),
  drop constraint if exists voice_execution_reservation_state_check,
  add constraint voice_execution_reservation_state_check check (reservation_state in (
    'reserved', 'temporal_started', 'provider_started', 'blocked', 'failed', 'timed_out', 'completed'
  ));

-- Preserve historical rows. The canonical Phase 1 hash is used whenever it is
-- available; the deterministic E.164 fallback is only for pre-Phase-1 rows.
update public.voice_executions e
   set recipient_phone_hash = coalesce(
     (select p.phone_hash from public.prospects p where p.id = e.prospect_id and p.user_id = e.user_id),
     encode(digest(convert_to(regexp_replace(trim(e.recipient_phone), '[[:space:]().-]', '', 'g'), 'UTF8'), 'sha256'), 'hex'))
 where e.recipient_phone_hash is null
   and regexp_replace(trim(e.recipient_phone), '[[:space:]().-]', '', 'g') ~ '^\\+[1-9][0-9]{7,14}$';

update public.voice_executions e
   set request_idempotency_key = request_key::text
 where request_idempotency_key is null;

with numbered as (
  select id, row_number() over (partition by user_id, recipient_phone_hash order by created_at, id) as n
  from public.voice_executions where recipient_phone_hash is not null
)
update public.voice_executions e set attempt_number = numbered.n
from numbered where numbered.id = e.id and e.attempt_number is null;

-- Historical local failures did not reach a provider and must remain auditable
-- without consuming the person-level attempt.
update public.voice_executions
   set counts_toward_call_limit = false, reservation_state = 'failed'
 where status = 'failed' and provider_status = 'request_failed' and provider_execution_id is null;

update public.voice_executions
   set reservation_state = case
     when provider_status = 'provider_event_timeout' then 'timed_out'
     when status = 'completed' then 'completed'
     when status = 'failed' then 'failed'
     when provider_execution_id is not null then 'provider_started'
     else 'reserved'
   end;

drop index if exists public.voice_one_attempt_per_lead_idx;
create unique index if not exists voice_one_default_attempt_per_person_idx
  on public.voice_executions(user_id, recipient_phone_hash)
  where recipient_phone_hash is not null and counts_toward_call_limit = true and is_override = false;
create unique index if not exists voice_execution_request_idempotency_idx
  on public.voice_executions(user_id, request_idempotency_key)
  where request_idempotency_key is not null;
create unique index if not exists voice_execution_person_attempt_idx
  on public.voice_executions(user_id, recipient_phone_hash, attempt_number)
  where recipient_phone_hash is not null and attempt_number is not null;
create index if not exists voice_execution_person_lookup_idx
  on public.voice_executions(user_id, recipient_phone_hash, created_at desc);

create table if not exists public.voice_call_override_audits (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  prospect_id uuid not null,
  recipient_phone_hash text not null,
  override_reason text not null check (length(trim(override_reason)) >= 10),
  source text not null check (source in ('ui','chat','api','dispatcher','temporal')),
  actor text not null,
  approval_id uuid not null references public.outreach_action_approvals(id),
  prior_execution_id uuid not null references public.voice_executions(id),
  new_execution_id uuid not null references public.voice_executions(id),
  created_at timestamptz not null default now(),
  unique(new_execution_id),
  foreign key(prospect_id, user_id) references public.prospects(id, user_id) on delete cascade
);
create or replace function public.prevent_voice_override_audit_mutation()
returns trigger language plpgsql as $$ begin
  raise exception 'voice call override audits are immutable';
end $$;
drop trigger if exists voice_call_override_audits_immutable on public.voice_call_override_audits;
create trigger voice_call_override_audits_immutable before update or delete
  on public.voice_call_override_audits for each row execute function public.prevent_voice_override_audit_mutation();

-- One atomic reservation is required before either the direct or Temporal
-- path can decrypt a provider credential. Advisory locking makes attempt
-- numbering deterministic; the partial unique index is the definitive guard.
create or replace function public.reserve_voice_execution(
  p_user_id uuid, p_connection_id uuid, p_prospect_id uuid,
  p_recipient_phone text, p_recipient_phone_hash text,
  p_request_idempotency_key text, p_context_snapshot jsonb,
  p_is_override boolean default false, p_override_reason text default null,
  p_approval_id uuid default null, p_source text default 'api', p_actor text default 'user'
) returns table(
  disposition text, execution_id uuid, prior_execution_id uuid, attempt_number integer
) language plpgsql security definer set search_path = public as $$
declare v_existing public.voice_executions%rowtype; v_prior public.voice_executions%rowtype;
declare v_attempt integer; v_approval public.outreach_action_approvals%rowtype;
begin
  if p_recipient_phone_hash is null or length(trim(p_recipient_phone_hash)) <> 64 then
    raise exception 'A canonical recipient phone hash is required';
  end if;
  if p_request_idempotency_key is null or length(trim(p_request_idempotency_key)) = 0 then
    raise exception 'A request idempotency key is required';
  end if;
  perform pg_advisory_xact_lock(hashtextextended(p_user_id::text || ':' || p_recipient_phone_hash, 0));
  select * into v_existing from public.voice_executions
    where user_id = p_user_id and request_idempotency_key = p_request_idempotency_key;
  if found then
    return query select 'idempotent'::text, v_existing.id, v_existing.override_of_execution_id, v_existing.attempt_number;
    return;
  end if;
  select * into v_prior from public.voice_executions
    where user_id = p_user_id and recipient_phone_hash = p_recipient_phone_hash
      and counts_toward_call_limit = true
    order by created_at desc, id desc limit 1;
  if not p_is_override and found then
    return query select 'already_called'::text, null::uuid, v_prior.id, v_prior.attempt_number;
    return;
  end if;
  if p_is_override then
    if p_override_reason is null or length(trim(p_override_reason)) < 10 or p_approval_id is null then
      raise exception 'An approved meaningful override reason is required';
    end if;
    if not found then raise exception 'An override requires a prior call execution'; end if;
    select * into v_approval from public.outreach_action_approvals
      where id = p_approval_id and user_id = p_user_id and confirmed_at is not null
        and consumed_at is null and (expires_at is null or expires_at > now()) for update;
    if not found then raise exception 'Override approval is missing, expired, or already used'; end if;
    if coalesce(v_approval.scope->'prospectIds', '[]'::jsonb) <> '[]'::jsonb
       and not coalesce(v_approval.scope->'prospectIds', '[]'::jsonb) ? p_prospect_id::text then
      raise exception 'Override approval does not cover this prospect';
    end if;
    if v_approval.override_reason is not null and trim(v_approval.override_reason) <> trim(p_override_reason) then
      raise exception 'Override reason does not match the approval';
    end if;
    update public.outreach_action_approvals set consumed_at = now()
      where id = p_approval_id and user_id = p_user_id and consumed_at is null;
  end if;
  select coalesce(max(attempt_number), 0) + 1 into v_attempt from public.voice_executions
    where user_id = p_user_id and recipient_phone_hash = p_recipient_phone_hash;
  insert into public.voice_executions(
    user_id, connection_id, prospect_id, recipient_phone, recipient_phone_hash,
    request_idempotency_key, attempt_number, status, provider_status, reservation_state,
    context_snapshot, counts_toward_call_limit, is_override, override_reason,
    override_authorized_by, override_authorized_at, override_of_execution_id, action_approval_id
  ) values (
    p_user_id, p_connection_id, p_prospect_id, p_recipient_phone, p_recipient_phone_hash,
    p_request_idempotency_key, v_attempt, 'queued', 'local_queued', 'reserved',
    coalesce(p_context_snapshot, '{}'::jsonb), true, p_is_override, p_override_reason,
    case when p_is_override then p_user_id else null end,
    case when p_is_override then now() else null end,
    case when p_is_override then v_prior.id else null end,
    case when p_is_override then p_approval_id else null end
  ) returning * into v_existing;
  if p_is_override then
    insert into public.voice_call_override_audits(
      user_id, prospect_id, recipient_phone_hash, override_reason, source, actor,
      approval_id, prior_execution_id, new_execution_id
    ) values (p_user_id, p_prospect_id, p_recipient_phone_hash, p_override_reason,
      p_source, p_actor, p_approval_id, v_prior.id, v_existing.id);
  end if;
  return query select 'reserved'::text, v_existing.id, case when p_is_override then v_prior.id else null end, v_attempt;
exception when unique_violation then
  select * into v_prior from public.voice_executions
    where user_id = p_user_id and recipient_phone_hash = p_recipient_phone_hash
      and counts_toward_call_limit = true and is_override = false
    order by created_at desc limit 1;
  return query select 'already_called'::text, null::uuid, v_prior.id, v_prior.attempt_number;
end $$;

-- ---------------------------------------------------------------------
-- 20260906000800_voice_override_scope_guard.sql
-- ---------------------------------------------------------------------

-- Follow-up to the applied Phase 4 reservation migration: an override
-- approval must explicitly name the prospect it authorizes.
create or replace function public.enforce_voice_override_approval_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_scope jsonb; v_user_id uuid; v_confirmed_at timestamptz; v_expires_at timestamptz;
begin
  if new.is_override is not true then return new; end if;
  select user_id, scope, confirmed_at, expires_at
    into v_user_id, v_scope, v_confirmed_at, v_expires_at
  from public.outreach_action_approvals where id = new.action_approval_id;
  if v_user_id is distinct from new.user_id or v_confirmed_at is null
     or (v_expires_at is not null and v_expires_at <= now()) then
    raise exception 'Override approval is not current and owned by this user';
  end if;
  if not (v_scope ? 'prospectIds')
     or jsonb_typeof(v_scope->'prospectIds') <> 'array'
     or not (v_scope->'prospectIds' ? new.prospect_id::text) then
    raise exception 'Override approval does not explicitly cover this prospect';
  end if;
  return new;
end $$;
drop trigger if exists trg_voice_override_approval_scope on public.voice_executions;
create trigger trg_voice_override_approval_scope before insert or update of is_override, action_approval_id, prospect_id
  on public.voice_executions for each row execute function public.enforce_voice_override_approval_scope();

-- ---------------------------------------------------------------------
-- 20260906000900_voice_call_intelligence.sql
-- ---------------------------------------------------------------------

-- Delivery Phase 5: additive, tenant-owned call intelligence records.
-- Bolna documents total_cost as a float measured in cents, so this is numeric
-- rather than an integer: fractional provider minor-units must never be rounded.
alter table public.voice_connections
  add column if not exists billing_currency text,
  drop constraint if exists voice_connections_billing_currency_check,
  add constraint voice_connections_billing_currency_check
    check (billing_currency is null or billing_currency ~ '^[A-Z]{3}$');

alter table public.voice_executions
  alter column cost_minor_units type numeric(20, 6)
    using cost_minor_units::numeric(20, 6),
  alter column duration_seconds type numeric(18, 3)
    using duration_seconds::numeric(18, 3),
  add column if not exists started_at timestamptz,
  add column if not exists answered_at timestamptz,
  add column if not exists answered boolean not null default false,
  add column if not exists cost_currency text,
  add column if not exists cost_unit text not null default 'cent',
  add column if not exists cost_breakdown jsonb not null default '{}'::jsonb,
  add column if not exists outcome_data jsonb not null default '{}'::jsonb,
  add column if not exists recording_metadata jsonb not null default '{}'::jsonb,
  add column if not exists provider_metadata jsonb not null default '{}'::jsonb,
  add column if not exists provider_event_at timestamptz;

alter table public.voice_executions
  drop constraint if exists voice_executions_cost_minor_units_nonnegative,
  add constraint voice_executions_cost_minor_units_nonnegative
    check (cost_minor_units is null or cost_minor_units >= 0),
  drop constraint if exists voice_executions_cost_currency_check,
  add constraint voice_executions_cost_currency_check
    check (cost_currency is null or cost_currency ~ '^[A-Z]{3}$');

create index if not exists voice_executions_analytics_idx
  on public.voice_executions(user_id, created_at desc);
create index if not exists voice_executions_provider_event_idx
  on public.voice_executions(connection_id, provider_execution_id, provider_event_at desc)
  where provider_execution_id is not null;

-- ---------------------------------------------------------------------
-- 20260907001000_chat_followup_approval.sql
-- ---------------------------------------------------------------------

-- Phase 6: a scheduled chat follow-up retains the scoped approval that will
-- be checked again by the Phase 3 dispatcher at execution time.
alter table public.lead_followups
  add column if not exists approval_id uuid references public.outreach_action_approvals(id) on delete set null;

create index if not exists lead_followups_due_idx
  on public.lead_followups(status, scheduled_at)
  where status = 'scheduled';

-- ---------------------------------------------------------------------
-- 20260907001100_unified_lead_handoffs.sql
-- ---------------------------------------------------------------------

-- Delivery Phase 7: one durable, tenant-owned human handoff queue.
create table if not exists public.lead_handoffs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  prospect_id uuid not null,
  source_type text not null check (source_type in ('email_reply','voice_call','callback_request','meeting_request','agent_tool','system')),
  source_id text not null,
  reason text not null,
  priority text not null default 'normal' check (priority in ('low','normal','high','urgent')),
  summary text not null,
  recommended_next_action text not null,
  due_at timestamptz,
  assigned_to uuid references public.users(id) on delete set null,
  status text not null default 'open' check (status in ('open','acknowledged','resolved','dismissed')),
  resolution_metadata jsonb not null default '{}'::jsonb,
  idempotency_key text not null,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(), resolved_at timestamptz,
  unique (id,user_id),
  unique (user_id,idempotency_key),
  foreign key (prospect_id,user_id) references public.prospects(id,user_id) on delete cascade
);

create index if not exists lead_handoffs_tenant_inbox_idx on public.lead_handoffs(user_id,status,priority,due_at,created_at desc);
create unique index if not exists lead_handoffs_source_reason_dedupe_idx on public.lead_handoffs(user_id,source_type,source_id,reason);

create table if not exists public.lead_handoff_notification_outbox (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references public.users(id) on delete cascade,
  handoff_id uuid not null,
  channel text not null check (channel in ('slack','push')),
  idempotency_key text not null,
  attempts integer not null default 0,
  delivered_at timestamptz,
  last_error text,
  created_at timestamptz not null default now(), updated_at timestamptz not null default now(),
  unique(user_id,idempotency_key),
  foreign key(handoff_id,user_id) references public.lead_handoffs(id,user_id) on delete cascade
);
create index if not exists lead_handoff_outbox_pending_idx on public.lead_handoff_notification_outbox(created_at) where delivered_at is null;

-- ---------------------------------------------------------------------
-- 20260908000100_phase8_safety_hardening.sql
-- ---------------------------------------------------------------------

do $$ begin
  if not exists (
    select 1 from pg_constraint
    where conname = 'outreach_action_approvals_id_user_key'
      and conrelid = 'public.outreach_action_approvals'::regclass
  ) then
    alter table public.outreach_action_approvals
      add constraint outreach_action_approvals_id_user_key unique (id, user_id);
  end if;
end $$;

alter table public.outreach_schedules
  drop constraint if exists outreach_schedules_approval_id_fkey,
  drop constraint if exists outreach_schedules_owned_approval_fkey,
  add constraint outreach_schedules_owned_approval_fkey
    foreign key (approval_id, user_id)
    references public.outreach_action_approvals(id, user_id);
alter table public.outreach_runs
  drop constraint if exists outreach_runs_approval_id_fkey,
  drop constraint if exists outreach_runs_owned_approval_fkey,
  add constraint outreach_runs_owned_approval_fkey
    foreign key (approval_id, user_id)
    references public.outreach_action_approvals(id, user_id);
alter table public.lead_followups
  drop constraint if exists lead_followups_approval_id_fkey,
  drop constraint if exists lead_followups_owned_approval_fkey,
  add constraint lead_followups_owned_approval_fkey
    foreign key (approval_id, user_id)
    references public.outreach_action_approvals(id, user_id);
alter table public.voice_executions
  drop constraint if exists voice_executions_action_approval_id_fkey,
  drop constraint if exists voice_executions_owned_action_approval_fkey,
  add constraint voice_executions_owned_action_approval_fkey
    foreign key (action_approval_id, user_id)
    references public.outreach_action_approvals(id, user_id);
alter table public.voice_call_override_audits
  drop constraint if exists voice_call_override_audits_approval_id_fkey,
  drop constraint if exists voice_override_audits_owned_approval_fkey,
  add constraint voice_override_audits_owned_approval_fkey
    foreign key (approval_id, user_id)
    references public.outreach_action_approvals(id, user_id);

-- One immediate approval can create only one run. Recurring schedules retain
-- their explicit occurrence idempotency key and are intentionally excluded.
create unique index if not exists outreach_runs_one_immediate_run_per_approval
  on public.outreach_runs(user_id, approval_id)
  where schedule_id is null;
create unique index if not exists outreach_schedules_one_schedule_per_approval
  on public.outreach_schedules(user_id, approval_id);

-- Override scope accepts only the two deliberate voice actions and requires an
-- exact prospect ID, confirmed consent attestation, matching reason, and owner.
create or replace function public.enforce_voice_override_approval_scope()
returns trigger language plpgsql security definer set search_path = public as $$
declare v_approval public.outreach_action_approvals%rowtype;
begin
  if new.is_override is not true then return new; end if;
  select * into v_approval
    from public.outreach_action_approvals
   where id = new.action_approval_id;
  if not found
     or v_approval.user_id is distinct from new.user_id
     or v_approval.action_kind not in ('voice_call_override', 'qualification_calls_batch')
     or v_approval.channel <> 'voice'
     or v_approval.confirmed_at is null
     or v_approval.consumed_at is not null
     or (v_approval.expires_at is not null and v_approval.expires_at <= now())
     or coalesce((v_approval.consent_attestation->>'confirmed')::boolean, false) is not true then
    raise exception 'Override approval is not current, confirmed, action-specific, and owned';
  end if;
  if not (
    (jsonb_typeof(v_approval.scope->'prospectIds') = 'array'
      and v_approval.scope->'prospectIds' ? new.prospect_id::text)
    or
    (jsonb_typeof(v_approval.scope->'leadIds') = 'array'
      and v_approval.scope->'leadIds' ? new.prospect_id::text)
  ) then
    raise exception 'Override approval does not explicitly cover this prospect';
  end if;
  if trim(coalesce(v_approval.override_reason, '')) <> trim(coalesce(new.override_reason, '')) then
    raise exception 'Override reason does not match the approval';
  end if;
  return new;
end $$;

create or replace function public.reserve_voice_execution(
  p_user_id uuid, p_connection_id uuid, p_prospect_id uuid,
  p_recipient_phone text, p_recipient_phone_hash text,
  p_request_idempotency_key text, p_context_snapshot jsonb,
  p_is_override boolean default false, p_override_reason text default null,
  p_approval_id uuid default null, p_source text default 'api', p_actor text default 'user'
) returns table(
  disposition text, execution_id uuid, prior_execution_id uuid, attempt_number integer
) language plpgsql security definer set search_path = public as $$
declare
  v_existing public.voice_executions%rowtype;
  v_prior public.voice_executions%rowtype;
  v_attempt integer;
  v_approval public.outreach_action_approvals%rowtype;
  v_consumed integer;
begin
  if p_recipient_phone_hash is null or length(trim(p_recipient_phone_hash)) <> 64 then
    raise exception 'A canonical recipient phone hash is required';
  end if;
  if p_request_idempotency_key is null or length(trim(p_request_idempotency_key)) = 0 then
    raise exception 'A request idempotency key is required';
  end if;
  if not exists (
    select 1 from public.voice_connections vc
     where vc.id = p_connection_id and vc.user_id = p_user_id
       and vc.provider = 'bolna' and vc.status = 'active'
  ) then
    raise exception 'Voice connection is not active or is not owned by this user';
  end if;
  if not exists (
    select 1 from public.prospects p
     where p.id = p_prospect_id and p.user_id = p_user_id
  ) then
    raise exception 'Prospect is not owned by this user';
  end if;

  perform pg_advisory_xact_lock(
    hashtextextended(p_user_id::text || ':' || p_recipient_phone_hash, 0)
  );
  select * into v_existing
    from public.voice_executions ve
   where ve.user_id = p_user_id
     and ve.request_idempotency_key = p_request_idempotency_key;
  if found then
    return query select 'idempotent'::text, v_existing.id,
      v_existing.override_of_execution_id, v_existing.attempt_number;
    return;
  end if;

  select * into v_prior
    from public.voice_executions ve
   where ve.user_id = p_user_id
     and ve.recipient_phone_hash = p_recipient_phone_hash
     and ve.counts_toward_call_limit = true
   order by ve.created_at desc, ve.id desc limit 1;
  if not p_is_override and found then
    return query select 'already_called'::text, null::uuid, v_prior.id,
      v_prior.attempt_number;
    return;
  end if;

  if p_is_override then
    if p_override_reason is null or length(trim(p_override_reason)) < 10 or p_approval_id is null then
      raise exception 'An approved meaningful override reason is required';
    end if;
    if v_prior.id is null then
      raise exception 'An override requires a prior call execution';
    end if;
    select * into v_approval
      from public.outreach_action_approvals oa
     where oa.id = p_approval_id and oa.user_id = p_user_id
       and oa.action_kind in ('voice_call_override', 'qualification_calls_batch')
       and oa.channel = 'voice'
       and oa.confirmed_at is not null and oa.consumed_at is null
       and (oa.expires_at is null or oa.expires_at > now())
       and coalesce((oa.consent_attestation->>'confirmed')::boolean, false) = true
     for update;
    if not found then
      raise exception 'Override approval is missing, expired, consumed, or invalid';
    end if;
    if not (
      (jsonb_typeof(v_approval.scope->'prospectIds') = 'array'
        and v_approval.scope->'prospectIds' ? p_prospect_id::text)
      or
      (jsonb_typeof(v_approval.scope->'leadIds') = 'array'
        and v_approval.scope->'leadIds' ? p_prospect_id::text)
    ) then
      raise exception 'Override approval does not cover this prospect';
    end if;
    if trim(coalesce(v_approval.override_reason, '')) <> trim(p_override_reason) then
      raise exception 'Override reason does not match the approval';
    end if;
    update public.outreach_action_approvals oa
       set consumed_at = now()
     where oa.id = p_approval_id and oa.user_id = p_user_id
       and oa.consumed_at is null;
    get diagnostics v_consumed = row_count;
    if v_consumed <> 1 then
      raise exception 'Override approval was already consumed';
    end if;
  end if;

  select coalesce(max(ve.attempt_number), 0) + 1 into v_attempt
    from public.voice_executions ve
   where ve.user_id = p_user_id
     and ve.recipient_phone_hash = p_recipient_phone_hash;

  insert into public.voice_executions(
    user_id, connection_id, prospect_id, recipient_phone, recipient_phone_hash,
    request_idempotency_key, attempt_number, status, provider_status, reservation_state,
    context_snapshot, counts_toward_call_limit, is_override, override_reason,
    override_authorized_by, override_authorized_at, override_of_execution_id, action_approval_id
  ) values (
    p_user_id, p_connection_id, p_prospect_id, p_recipient_phone, p_recipient_phone_hash,
    p_request_idempotency_key, v_attempt, 'queued', 'local_queued', 'reserved',
    coalesce(p_context_snapshot, '{}'::jsonb), true, p_is_override,
    case when p_is_override then trim(p_override_reason) else null end,
    case when p_is_override then p_user_id else null end,
    case when p_is_override then now() else null end,
    case when p_is_override then v_prior.id else null end,
    case when p_is_override then p_approval_id else null end
  ) returning * into v_existing;

  if p_is_override then
    insert into public.voice_call_override_audits(
      user_id, prospect_id, recipient_phone_hash, override_reason, source, actor,
      approval_id, prior_execution_id, new_execution_id
    ) values (
      p_user_id, p_prospect_id, p_recipient_phone_hash, trim(p_override_reason),
      p_source, p_actor, p_approval_id, v_prior.id, v_existing.id
    );
  end if;
  return query select 'reserved'::text, v_existing.id,
    case when p_is_override then v_prior.id else null end, v_attempt;
exception when unique_violation then
  select * into v_existing
    from public.voice_executions ve
   where ve.user_id = p_user_id
     and ve.request_idempotency_key = p_request_idempotency_key;
  if found then
    return query select 'idempotent'::text, v_existing.id,
      v_existing.override_of_execution_id, v_existing.attempt_number;
    return;
  end if;
  select * into v_prior
    from public.voice_executions ve
   where ve.user_id = p_user_id
     and ve.recipient_phone_hash = p_recipient_phone_hash
     and ve.counts_toward_call_limit = true and ve.is_override = false
   order by ve.created_at desc, ve.id desc limit 1;
  return query select 'already_called'::text, null::uuid, v_prior.id,
    v_prior.attempt_number;
end $$;

-- Claiming before Gmail is the at-most-once boundary. A worker crash can leave
-- a row in `sending` for manual reconciliation, but will never auto-send it a
-- second time when Gmail's contract cannot deduplicate an ambiguous timeout.
alter table public.campaign_recipients
  drop constraint if exists campaign_recipients_status_check;
alter table public.campaign_recipients
  add constraint campaign_recipients_status_check check (status in (
    'pending','approved','scheduled','sending','sent','opened','replied',
    'bounced','unsubscribed','skipped','failed'
  ));

create or replace function public.claim_campaign_recipients(
  p_user_id uuid, p_campaign_id uuid, p_daily_cap integer
) returns setof public.campaign_recipients
language plpgsql security definer set search_path = public as $$
declare
  v_mailbox_id uuid;
  v_daily_sent integer;
  v_mailbox_limit integer;
  v_limit integer;
  v_claimed integer;
begin
  select m.id,
         case when m.last_reset_at::date < now()::date then 0 else m.daily_sent end,
         m.daily_send_limit
    into v_mailbox_id, v_daily_sent, v_mailbox_limit
    from public.campaigns c
    join public.mailboxes m on m.id = c.mailbox_id and m.user_id = c.user_id
   where c.id = p_campaign_id and c.user_id = p_user_id
     and c.status = 'active' and m.status = 'active'
   for update of m;
  if not found then return; end if;

  if v_daily_sent = 0 then
    update public.mailboxes
       set daily_sent = 0,
           last_reset_at = case when last_reset_at::date < now()::date then now() else last_reset_at end
     where id = v_mailbox_id and user_id = p_user_id;
  end if;
  v_limit := greatest(least(
    coalesce(p_daily_cap, 0) - v_daily_sent,
    coalesce(v_mailbox_limit, 0) - v_daily_sent,
    100
  ), 0);
  if v_limit = 0 then return; end if;

  return query with claimable as (
    select cr.id
      from public.campaign_recipients cr
      join public.campaigns c
        on c.id = cr.campaign_id and c.user_id = cr.user_id
      join public.mailboxes m
        on m.id = c.mailbox_id and m.user_id = c.user_id
     where cr.user_id = p_user_id and cr.campaign_id = p_campaign_id
       and cr.status = 'scheduled' and cr.scheduled_for <= now()
       and c.status = 'active' and m.status = 'active'
       and extract(hour from now() at time zone c.timezone)
           >= c.send_window_start_hour
       and extract(hour from now() at time zone c.timezone)
           < c.send_window_end_hour
     order by cr.scheduled_for, cr.id
     for update of cr skip locked
     limit v_limit
  )
  update public.campaign_recipients cr
     set status = 'sending'
    from claimable c
   where cr.id = c.id and cr.user_id = p_user_id
  returning cr.*;
  get diagnostics v_claimed = row_count;
  update public.mailboxes
     set daily_sent = daily_sent + v_claimed
   where id = v_mailbox_id and user_id = p_user_id;
end;
$$;

create or replace function public.list_due_outreach_runs(p_limit integer default 100)
returns table(user_id uuid, run_id uuid)
language sql security definer set search_path = public as $$
  select distinct ori.user_id, ori.run_id
    from public.outreach_run_items ori
    join public.outreach_runs r
      on r.id = ori.run_id and r.user_id = ori.user_id
   where ori.status = 'pending' and ori.scheduled_for <= now()
     and r.status in ('pending','running','partial')
   order by ori.run_id
   limit greatest(least(p_limit, 500), 0);
$$;

alter table public.lead_handoff_notification_outbox
  add column if not exists processing_at timestamptz;

create or replace function public.claim_handoff_notifications(p_limit integer default 50)
returns setof public.lead_handoff_notification_outbox
language sql security definer set search_path = public as $$
  with claimable as (
    select o.id
      from public.lead_handoff_notification_outbox o
     where o.delivered_at is null and o.processing_at is null
     order by o.created_at, o.id
     for update skip locked
     limit greatest(least(p_limit, 100), 0)
  )
  update public.lead_handoff_notification_outbox o
     set processing_at = now(), attempts = attempts + 1, updated_at = now()
    from claimable c
   where o.id = c.id
  returning o.*;
$$;

-- ---------------------------------------------------------------------
-- 20260909000100_campaign_timezone_compatibility.sql
-- ---------------------------------------------------------------------

-- The original campaigns table was created by 0005 before 0007's
-- CREATE TABLE IF NOT EXISTS declaration, so 0007 could not add this column.
-- Existing send-window hours were explicitly stored as UTC hours; defaulting
-- existing and new legacy campaign rows to UTC preserves that meaning while
-- allowing the Phase 8 claim function to use an explicit IANA timezone.
alter table public.campaigns
  add column if not exists timezone text not null default 'UTC';

comment on column public.campaigns.timezone is
  'IANA timezone used to interpret send_window_start_hour and send_window_end_hour.';