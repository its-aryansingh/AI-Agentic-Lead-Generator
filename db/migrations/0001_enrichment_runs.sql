-- =====================================================================
-- 0001_enrichment_runs.sql  (Railway PostgreSQL variant)
-- Public-contact enrichment: durable run state + prospect result fields.
--
-- WHY A SEPARATE TABLE:
--   prospects.status is a CHECK-constrained sales/enrichment lifecycle
--   ('pending','enriching','researching','drafting','completed','failed')
--   and prospects.stage is the kanban column. Neither can carry crawl
--   state without a long-running scrape corrupting sales state on retry.
--   enrichment_runs is the crawl state machine; prospects only ever
--   receives the final, validated projection.
--
-- OWNERSHIP MODEL (important):
--   public.prospects has NO user_id column. Ownership is
--   prospects.job_id -> jobs.id -> jobs.user_id. Every policy and RPC
--   below uses that join. Do not assume prospects.user_id exists.
--
-- ADDITIVE + IDEMPOTENT. No drops, no renames, no data migration.
-- =====================================================================

-- ---------------------------------------------------------------------
-- 1. Run control table
-- ---------------------------------------------------------------------

create table if not exists public.enrichment_runs (
  id uuid primary key default gen_random_uuid(),
  -- public.users on Railway is your own table (no auth.users behind it).
  user_id uuid not null references public.users(id) on delete cascade,
  prospect_id uuid not null references public.prospects(id) on delete cascade,

  -- Normalized registrable domain actually crawled (never a raw user URL).
  domain text not null,

  -- Caller-scoped dedupe key. Same key => same run, no second crawl.
  idempotency_key text not null,

  status text not null default 'queued'
    check (status in ('queued','running','succeeded','failed','skipped')),

  attempt int not null default 0,

  -- Observability counters. Never store DOM text or contact values here.
  pages_crawled int not null default 0,
  emails_found  int not null default 0,
  phones_found  int not null default 0,
  contacts_found int not null default 0,

  -- Public URLs the data came from (DPDP: provenance for every field).
  source_urls jsonb not null default '[]'::jsonb,

  model text,
  prompt_tokens     int not null default 0,
  completion_tokens int not null default 0,
  cost_paise        int not null default 0,

  error_code   text,
  error_detail text,

  created_at  timestamptz not null default now(),
  started_at  timestamptz,
  finished_at timestamptz
);

-- Idempotency: one run per (user, key). ON CONFLICT DO NOTHING on insert.
create unique index if not exists enrichment_runs_idem_idx
  on public.enrichment_runs(user_id, idempotency_key);

create index if not exists enrichment_runs_prospect_idx
  on public.enrichment_runs(prospect_id, created_at desc);

-- Reconciliation cron: find runs stuck in queued/running.
create index if not exists enrichment_runs_stuck_idx
  on public.enrichment_runs(status, created_at)
  where status in ('queued','running');

-- Per-domain courtesy: how recently did we crawl this host for anyone?
create index if not exists enrichment_runs_domain_idx
  on public.enrichment_runs(domain, created_at desc);

-- NO ROW LEVEL SECURITY ON RAILWAY.
--
-- The Supabase build enabled RLS with a policy on auth.uid(). Railway has
-- no auth.uid() and no PostgREST role switching, so a policy here would
-- either never match (locking the table) or be dead code that reads like
-- protection. It is omitted deliberately.
--
-- Ownership is enforced in exactly two places instead:
--   1. the jobs join in every query in lib/enrichment/run-service.ts
--   2. the re-check inside complete_enrichment_run() below
-- If you later add a per-request Postgres role, revisit this.

-- ---------------------------------------------------------------------
-- 2. Prospect result fields
--    Only normalized, published-business values. No DOM text.
-- ---------------------------------------------------------------------

alter table public.prospects
  add column if not exists enrichment_status text
    check (enrichment_status in ('queued','running','succeeded','failed','skipped'));

-- Deliberately NOT a foreign key: prospects and enrichment_runs would
-- form a cycle, which complicates cascade deletes for no real benefit.
alter table public.prospects
  add column if not exists enrichment_run_id uuid;

alter table public.prospects
  add column if not exists enriched_at timestamptz;

-- E.164 form of prospects.phone, when we could prove it is Indian.
alter table public.prospects
  add column if not exists phone_e164 text;

alter table public.prospects
  add column if not exists phone_source text
    check (phone_source in ('scraped_public','csv_import','manual','none'));

-- Public, company-level contact surface:
--   { emails: [{value, page_url}], phones: [{e164, raw, type, page_url}],
--     key_contacts: [{name, title, page_url}], social_links: [...],
--     source_urls: [...], extracted_at }
alter table public.prospects
  add column if not exists public_contacts jsonb;

create index if not exists prospects_enrichment_status_idx
  on public.prospects(enrichment_status)
  where enrichment_status is not null;

-- ---------------------------------------------------------------------
-- 3. Atomic completion RPC
--
--    Called by the worker with the service-role key. Re-checks ownership
--    via the jobs join so a bug in the worker cannot write across tenants
--    even though the service role bypasses RLS.
--
--    NON-DESTRUCTIVE MERGE RULES:
--      email  — filled only if currently null, or currently a
--               pattern_guessed value (a scraped fact beats a guess).
--               A human/verified email ('extracted' or confidence
--               'valid') is never overwritten.
--      phone  — filled only if currently null/blank.
--      others — always refreshed (they are enrichment-owned fields).
-- ---------------------------------------------------------------------

create or replace function public.complete_enrichment_run(
  p_run_id        uuid,
  p_user_id       uuid,
  p_prospect_id   uuid,
  p_status        text,
  p_email         text        default null,
  p_phone         text        default null,
  p_phone_e164    text        default null,
  p_public_contacts jsonb     default null,
  p_source_urls   jsonb       default '[]'::jsonb,
  p_pages_crawled int         default 0,
  p_emails_found  int         default 0,
  p_phones_found  int         default 0,
  p_contacts_found int        default 0,
  p_model         text        default null,
  p_prompt_tokens int         default 0,
  p_completion_tokens int     default 0,
  p_cost_paise    int         default 0,
  p_error_code    text        default null,
  p_error_detail  text        default null
)
returns table (updated_prospect boolean, run_status text)
language plpgsql
security definer
set search_path = public
as $$
declare
  v_owns boolean;
  v_did_update boolean := false;
begin
  if p_status not in ('succeeded','failed','skipped') then
    raise exception 'complete_enrichment_run: invalid terminal status %', p_status;
  end if;

  -- Ownership re-check: prospect -> job -> user. Composite, not just id.
  select exists (
    select 1
    from public.prospects pr
    join public.jobs j on j.id = pr.job_id
    where pr.id = p_prospect_id
      and j.user_id = p_user_id
  ) into v_owns;

  if not v_owns then
    raise exception 'complete_enrichment_run: prospect % not owned by user %',
      p_prospect_id, p_user_id;
  end if;

  update public.enrichment_runs
     set status            = p_status,
         pages_crawled     = p_pages_crawled,
         emails_found      = p_emails_found,
         phones_found      = p_phones_found,
         contacts_found    = p_contacts_found,
         source_urls       = coalesce(p_source_urls, '[]'::jsonb),
         model             = p_model,
         prompt_tokens     = p_prompt_tokens,
         completion_tokens = p_completion_tokens,
         cost_paise        = p_cost_paise,
         error_code        = p_error_code,
         error_detail      = p_error_detail,
         finished_at       = now()
   where id = p_run_id
     and user_id = p_user_id;

  if p_status = 'succeeded' then
    update public.prospects pr
       set enrichment_status = 'succeeded',
           enrichment_run_id = p_run_id,
           enriched_at       = now(),
           public_contacts   = coalesce(p_public_contacts, pr.public_contacts),

           -- Email: scraped fact beats null and beats a pattern guess.
           email = case
             when p_email is null then pr.email
             when pr.email is null then p_email
             when pr.email_source = 'pattern_guessed' then p_email
             else pr.email
           end,
           email_source = case
             when p_email is null then pr.email_source
             when pr.email is null or pr.email_source = 'pattern_guessed'
               then 'extracted'
             else pr.email_source
           end,
           email_confidence = case
             when p_email is null then pr.email_confidence
             when pr.email is null or pr.email_source = 'pattern_guessed'
               then 'valid'
             else pr.email_confidence
           end,

           -- Phone: never overwrite an existing number.
           phone = case
             when p_phone is null then pr.phone
             when pr.phone is null or btrim(pr.phone) = '' then p_phone
             else pr.phone
           end,
           phone_e164 = case
             when p_phone_e164 is null then pr.phone_e164
             when pr.phone is null or btrim(pr.phone) = '' then p_phone_e164
             else pr.phone_e164
           end,
           phone_source = case
             when p_phone is null then pr.phone_source
             when pr.phone is null or btrim(pr.phone) = '' then 'scraped_public'
             else pr.phone_source
           end
     where pr.id = p_prospect_id;

    v_did_update := true;
  else
    update public.prospects
       set enrichment_status = p_status,
           enrichment_run_id = p_run_id
     where id = p_prospect_id;
  end if;

  return query select v_did_update, p_status;
end;
$$;

-- Grants: Railway connects as a single application role (whatever
-- DATABASE_URL names, usually `postgres`), which already owns these
-- objects. The Supabase build revoked from anon/authenticated and granted
-- to service_role; none of those roles exist here, so a GRANT naming them
-- would abort the migration.
--
-- If you later add a least-privilege app role, this is where to grant it:
--   grant execute on function public.complete_enrichment_run(...) to leadgen_app;
