-- =====================================================================
-- 0003_salesengai.sql — Railway PostgreSQL
--
-- PORTED from the SalesEngAIMVP repo's ten Supabase migrations:
--
--     20260829000100_day2_context_leads_voice
--     20260829000200_gmail_hardening
--     20260829000300_day4_playbook_workspace
--     20260829000400_day5_replies_qualification
--     20260829000500_day6_voice
--     20260829000600_rotate_voice_webhook
--     20260829000700_day7_handoff_crm
--     20260829000800_day8_ai_providers
--     20260829000900_platform_credits_v2
--     20260901000100_search_provider_sources
--
-- The same two Supabase-isms 0000_base_schema.sql removed are removed
-- here, for the same reason:
--
--     13  enable row level security   -- RLS on with zero policies denies
--                                     everything: a silent outage, not a
--                                     safe default
--     13  create/drop policy ...      -- every one of them called
--                                     auth.uid(), which does not exist
--
-- Ownership for these thirteen tables therefore lives in lib/db/rls.ts,
-- exactly as it does for the tables in 0000. A table missing from that
-- map fails CLOSED, so a user-scoped query returns nothing until its
-- entry is added. The policies these replace were all the plain
-- `auth.uid() = user_id` shape except two, noted inline.
--
-- references public.users(id) is KEPT — public.users is the identity
-- table on Railway, so those foreign keys are real here.
--
-- Run order:  0000_base_schema → 0001_enrichment_runs → 0002_auth → 0003
-- Re-runnable: every statement is guarded (see the one exception noted
-- at "webhook rotation" below, which is deliberately not ported).
-- =====================================================================

-- =====================================================================
-- Day 2 — customer context, lead workflow, voice connections
-- =====================================================================

alter table public.jobs drop constraint if exists jobs_input_source_check;
alter table public.jobs add constraint jobs_input_source_check
  check (input_source in ('chat_search','chat_enrich','csv_upload','manual_entry'));

-- NOTE: prospects.phone is the raw scraped string this feature set works
-- with. It is NOT prospects.phone_e164 from 0001_enrichment_runs, which
-- is the normalized Indian number the enrichment pipeline proved. Both
-- columns coexist on purpose; do not collapse them.
alter table public.prospects
  add column if not exists input_title text,
  add column if not exists phone text,
  add column if not exists lead_status text not null default 'new',
  add column if not exists next_action text not null default 'review',
  add column if not exists next_action_at timestamptz;

alter table public.prospects drop constraint if exists prospects_lead_status_check;
alter table public.prospects add constraint prospects_lead_status_check
  check (lead_status in ('new','researching','ready','contacted','engaged',
                         'qualified','disqualified','converted','do_not_contact'));

-- next_action gains 'push_to_crm' in the Day 7 block below.
alter table public.prospects drop constraint if exists prospects_next_action_check;
alter table public.prospects add constraint prospects_next_action_check
  check (next_action in ('review','research','draft_email','send_email','call',
                         'follow_up','human_handoff','none'));

create index if not exists prospects_lead_workflow_idx
  on public.prospects(lead_status, next_action, next_action_at);

create table if not exists public.customer_contexts (
  user_id                   uuid primary key references public.users(id) on delete cascade,
  company_name              text,
  website_url               text,
  product_summary           text,
  ideal_customer_profile    text,
  value_proposition         text,
  qualification_criteria    text,
  disqualification_criteria text,
  approved_claims           text,
  prohibited_topics         text,
  default_language          text not null default 'English',
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now()
);

create table if not exists public.playbook_examples (
  id           uuid primary key default gen_random_uuid(),
  user_id      uuid not null references public.users(id) on delete cascade,
  example_type text not null check (example_type in ('email','call_transcript')),
  title        text not null,
  content      text not null,
  outcome      text,
  is_approved  boolean not null default true,   -- default flips to false in Day 4
  created_at   timestamptz not null default now(),
  updated_at   timestamptz not null default now()
);
create index if not exists playbook_examples_user_idx
  on public.playbook_examples(user_id, created_at desc);

create table if not exists public.voice_connections (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  provider          text not null default 'bolna' check (provider = 'bolna'),
  encrypted_api_key text not null,
  api_key_last_four text,
  agent_id          text not null,
  from_phone_number text,
  status            text not null default 'unverified'
    check (status in ('unverified','active','error','disconnected')),
  last_verified_at  timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.voice_executions (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(id) on delete cascade,
  connection_id         uuid not null references public.voice_connections(id) on delete cascade,
  prospect_id           uuid references public.prospects(id) on delete set null,
  provider_execution_id text,
  status                text not null default 'queued'
    check (status in ('queued','in_progress','completed','failed','cancelled')),
  recipient_phone       text not null,
  transcript            text,
  summary               text,
  outcome               text,
  duration_seconds      int,
  cost_minor_units      int,
  raw_payload           jsonb,
  created_at            timestamptz not null default now(),
  completed_at          timestamptz,
  unique (connection_id, provider_execution_id)
);
create index if not exists voice_executions_user_idx
  on public.voice_executions(user_id, created_at desc);

-- =====================================================================
-- Day 3 — encrypted Gmail credentials and connection lifecycle
-- =====================================================================

alter table public.mailboxes
  add column if not exists oauth_refresh_token_encrypted text,
  add column if not exists last_verified_at             timestamptz,
  add column if not exists last_error_code              text,
  add column if not exists last_error_message           text,
  add column if not exists disconnected_at              timestamptz;

alter table public.mailboxes drop constraint if exists mailboxes_status_check;
alter table public.mailboxes add constraint mailboxes_status_check
  check (status in ('pending','active','error','reconnect_required','disconnected'));

-- =====================================================================
-- Day 4 — approval-gated playbooks, immutable context snapshots
-- =====================================================================

alter table public.customer_contexts add column if not exists version int not null default 1;

alter table public.playbook_examples alter column is_approved set default false;
alter table public.playbook_examples
  add column if not exists redacted_content   text,
  add column if not exists extracted_guidance text,
  add column if not exists approved_at        timestamptz;

update public.playbook_examples
   set redacted_content = content,
       approved_at      = coalesce(approved_at, created_at)
 where is_approved = true
   and redacted_content is null;

alter table public.prospects
  add column if not exists context_version     int,
  add column if not exists context_snapshot    jsonb,
  add column if not exists playbook_example_ids uuid[];

alter table public.campaign_recipients
  add column if not exists context_version     int,
  add column if not exists context_snapshot    jsonb,
  add column if not exists playbook_example_ids uuid[];

create index if not exists prospects_next_action_due_idx
  on public.prospects(next_action_at)
  where next_action_at is not null and next_action <> 'none';

-- =====================================================================
-- Day 5 — idempotent inbound processing, evidence-backed qualification
-- =====================================================================

create table if not exists public.gmail_inbound_events (
  id                  uuid primary key default gen_random_uuid(),
  mailbox_id          uuid not null references public.mailboxes(id) on delete cascade,
  user_id             uuid not null references public.users(id) on delete cascade,
  recipient_id        uuid not null references public.campaign_recipients(id) on delete cascade,
  provider_message_id text not null,
  provider_thread_id  text not null,
  event_kind          text not null check (event_kind in ('reply','auto_reply','bounce')),
  processed_at        timestamptz,
  created_at          timestamptz not null default now(),
  unique (mailbox_id, provider_message_id)
);

create table if not exists public.lead_qualification_facts (
  id             uuid primary key default gen_random_uuid(),
  user_id        uuid not null references public.users(id) on delete cascade,
  prospect_id    uuid not null references public.prospects(id) on delete cascade,
  fact_key       text not null
    check (fact_key in ('interest','need','timeline','authority','budget','meeting_intent')),
  fact_value     text not null,
  -- 'voice' is added to source_type in the Day 6 block below.
  source_type    text not null check (source_type in ('reply','research','not_determined')),
  source_ref     text,
  source_excerpt text,
  confidence     numeric(4,3) not null check (confidence between 0 and 1),
  created_at     timestamptz not null default now(),
  unique (prospect_id, fact_key)
);

alter table public.prospects
  add column if not exists qualification_bucket text not null default 'not_determined';
alter table public.prospects drop constraint if exists prospects_qualification_bucket_check;
alter table public.prospects add constraint prospects_qualification_bucket_check
  check (qualification_bucket in ('hot','warm','nurture','disqualified','not_determined'));

-- reply_classifications.user_id is added by 0000_base_schema.sql (the
-- 0008_consolidate block), so this index has a column to stand on.
alter table public.reply_classifications add column if not exists provider_message_id text;
create unique index if not exists reply_classifications_provider_message_idx
  on public.reply_classifications(user_id, provider_message_id)
  where provider_message_id is not null;

create index if not exists qualification_facts_prospect_idx
  on public.lead_qualification_facts(prospect_id, created_at desc);

-- =====================================================================
-- Day 6 — customer-owned Bolna calling, consent, suppression, outcomes
-- =====================================================================

alter table public.voice_connections
  add column if not exists call_start_hour  int  not null default 9,
  add column if not exists call_end_hour    int  not null default 18,
  add column if not exists calling_timezone text not null default 'Asia/Kolkata';
alter table public.voice_connections drop constraint if exists voice_connection_hours_check;
alter table public.voice_connections add constraint voice_connection_hours_check
  check (call_start_hour between 0 and 23
     and call_end_hour   between 1 and 24
     and call_end_hour > call_start_hour);

alter table public.prospects
  add column if not exists voice_consent_status text not null default 'unknown';
alter table public.prospects drop constraint if exists prospects_voice_consent_check;
alter table public.prospects add constraint prospects_voice_consent_check
  check (voice_consent_status in ('unknown','confirmed','revoked'));

alter table public.voice_executions
  add column if not exists request_key      uuid not null default gen_random_uuid(),
  add column if not exists provider_status  text,
  add column if not exists recording_url    text,
  add column if not exists error_message    text,
  add column if not exists context_snapshot jsonb,
  add column if not exists updated_at       timestamptz not null default now();
create unique index if not exists voice_executions_request_key_idx
  on public.voice_executions(user_id, request_key);
create unique index if not exists voice_one_attempt_per_lead_idx
  on public.voice_executions(user_id, prospect_id)
  where prospect_id is not null;

-- phone_hash, not phone: a suppression list is exactly the data you do
-- not want readable if the table leaks.
create table if not exists public.phone_suppressions (
  id         uuid primary key default gen_random_uuid(),
  user_id    uuid not null references public.users(id) on delete cascade,
  phone_hash text not null,
  channel    text not null default 'voice' check (channel in ('voice','all')),
  reason     text not null
    check (reason in ('consent_revoked','do_not_call','manual','wrong_number')),
  created_at timestamptz not null default now(),
  unique (user_id, phone_hash, channel)
);

alter table public.lead_qualification_facts
  drop constraint if exists lead_qualification_facts_source_type_check;
alter table public.lead_qualification_facts
  add constraint lead_qualification_facts_source_type_check
  check (source_type in ('reply','voice','research','not_determined'));

-- Webhook rotation: the source migration 20260829000600 adds
-- webhook_version and then runs
--     update public.voice_connections set webhook_version = webhook_version + 1;
-- to invalidate webhook URLs already handed to Bolna. That bump is the
-- one statement in this file that is NOT re-runnable, and it is
-- meaningless on a database where voice_connections has never held a
-- row. The column is created; the bump is deliberately not ported.
-- Rotate deliberately, with its own migration, if a key ever leaks.
alter table public.voice_connections
  add column if not exists webhook_version int not null default 1;

-- =====================================================================
-- Day 7 — human handoff and encrypted customer CRM connections
-- =====================================================================

alter table public.prospects
  add column if not exists handoff_summary      text,
  add column if not exists handoff_generated_at timestamptz;

alter table public.prospects drop constraint if exists prospects_next_action_check;
alter table public.prospects add constraint prospects_next_action_check
  check (next_action in ('review','research','draft_email','send_email','call',
                         'follow_up','human_handoff','push_to_crm','none'));

create table if not exists public.crm_connections (
  id                    uuid primary key default gen_random_uuid(),
  user_id               uuid not null references public.users(id) on delete cascade,
  provider              text not null check (provider in ('hubspot','zoho')),
  encrypted_credentials text not null,
  credential_hint       text,
  region                text,
  status                text not null default 'unverified'
    check (status in ('unverified','active','error','disconnected')),
  last_verified_at      timestamptz,
  last_error            text,
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.crm_syncs (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  connection_id       uuid not null references public.crm_connections(id) on delete cascade,
  prospect_id         uuid not null references public.prospects(id) on delete cascade,
  provider            text not null check (provider in ('hubspot','zoho')),
  status              text not null check (status in ('completed','failed')),
  provider_contact_id text,
  provider_note_id    text,
  error_message       text,
  payload_snapshot    jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz not null default now(),
  unique (connection_id, prospect_id)
);
create index if not exists crm_syncs_user_created_idx
  on public.crm_syncs(user_id, created_at desc);

-- =====================================================================
-- Day 8 — customer-owned AI providers, model preferences, usage audit
-- =====================================================================

create table if not exists public.ai_provider_connections (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null references public.users(id) on delete cascade,
  provider          text not null check (provider in ('openai','anthropic')),
  encrypted_api_key text not null,
  api_key_last_four text,
  status            text not null default 'unverified'
    check (status in ('unverified','active','error','disconnected')),
  last_verified_at  timestamptz,
  last_error        text,
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  unique (user_id, provider)
);

create table if not exists public.ai_preferences (
  user_id         uuid primary key references public.users(id) on delete cascade,
  active_provider text not null default 'anthropic'
    check (active_provider in ('openai','anthropic')),
  chat_model      text not null default 'claude-sonnet-4-6',
  research_model  text not null default 'claude-haiku-4-5-20251001',
  writing_model   text not null default 'claude-sonnet-4-6',
  updated_at      timestamptz not null default now()
);

create table if not exists public.ai_usage_events (
  id                  uuid primary key default gen_random_uuid(),
  user_id             uuid not null references public.users(id) on delete cascade,
  provider            text not null check (provider in ('openai','anthropic')),
  model               text not null,
  operation           text not null,
  status              text not null check (status in ('completed','failed')),
  input_tokens        int,
  output_tokens       int,
  provider_request_id text,
  duration_ms         int,
  error_code          text,
  created_at          timestamptz not null default now()
);
create index if not exists ai_usage_user_created_idx
  on public.ai_usage_events(user_id, created_at desc);

-- =====================================================================
-- Platform-owned AI credits v2
--
-- ai_provider_connections is kept but dormant: nothing writes to it
-- after this migration, and existing encrypted keys are not read.
-- =====================================================================

alter table public.ai_usage_events add column if not exists credit_cost int;
create index if not exists ai_usage_op_user_idx
  on public.ai_usage_events(user_id, operation, created_at desc);

create table if not exists public.credit_packs (
  id               uuid primary key default gen_random_uuid(),
  user_id          uuid not null references public.users(id) on delete cascade,
  pack_id          text not null,                     -- e.g. "pack_6000"
  credits_added    int  not null,
  amount_inr       int,                               -- paise (100 = ₹1)
  amount_usd       int,                               -- cents
  payment_provider text check (payment_provider in ('stripe','razorpay','manual')),
  payment_id       text,                              -- Stripe session_id / Razorpay order_id
  created_at       timestamptz not null default now()
);
create index if not exists credit_packs_user_idx
  on public.credit_packs(user_id, created_at desc);

alter table public.users add column if not exists plan_rollover_credits int not null default 0;

-- Plan credit values are enforced in code: free=25, starter=500,
-- pro=2000, agency=6000. Enterprise is managed via addCredits().

-- =====================================================================
-- Discovery: keep persisted candidate analytics aligned with the
-- search aggregator's provider list
-- =====================================================================

alter table public.prospect_candidates
  drop constraint if exists prospect_candidates_source_check;
alter table public.prospect_candidates
  add constraint prospect_candidates_source_check
  check (source in ('brave','serper','tavily','exa','duckduckgo',
                    'github','producthunt','hn','csv','named','mock'));

-- =====================================================================
-- Ownership, for lib/db/rls.ts
--
-- Every policy dropped above was `auth.uid() = user_id` on a user_id
-- column, with two that were SELECT-only rather than FOR ALL:
--
--     gmail_inbound_events   select only
--     ai_usage_events        select only
--     credit_packs           select only
--
-- Those three are written by server-side code holding the service
-- client, and read by the owner. Encode that distinction in rls.ts
-- rather than losing it here.
-- =====================================================================
