-- 0001_init.sql

create extension if not exists pgcrypto;

create table users (
  id uuid primary key default gen_random_uuid(),
  email text unique not null,
  google_refresh_token text,
  plan text not null default 'free',
  credits_remaining int not null default 25,
  credits_reset_at timestamptz not null default (now() + interval '30 days'),
  voice_anchor_text text,
  created_at timestamptz not null default now()
);

create table chat_sessions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  title text,
  created_at timestamptz not null default now(),
  last_message_at timestamptz not null default now()
);
create index on chat_sessions(user_id, last_message_at desc);

create table chat_messages (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  role text not null check (role in ('user','assistant','tool')),
  content jsonb not null,
  created_at timestamptz not null default now()
);
create index on chat_messages(session_id, created_at);

create table prospect_candidates (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  source text not null check (source in ('brave','duckduckgo','github','producthunt','hn','csv','named')),
  source_ref text,                    -- URL or external ID
  preview jsonb not null,             -- name, title, company, snippet
  selected boolean default false,
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);
create index on prospect_candidates(session_id);

create table csv_uploads (
  id uuid primary key default gen_random_uuid(),
  session_id uuid not null references chat_sessions(id) on delete cascade,
  user_id uuid not null references users(id) on delete cascade,
  filename text not null,
  storage_path text not null,
  row_count int,
  column_headers jsonb,
  status text not null default 'staged',
  expires_at timestamptz not null default (now() + interval '24 hours'),
  created_at timestamptz not null default now()
);

create table jobs (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  source_session_id uuid references chat_sessions(id),
  input_source text default 'chat' check (input_source in ('chat_search','chat_enrich','csv_upload')),
  status text not null default 'pending' check (status in ('pending','processing','completed','failed','cancelled')),
  prospect_count int not null,
  sheet_url text,
  error_reason text,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on jobs(user_id, created_at desc);

create table prospects (
  id uuid primary key default gen_random_uuid(),
  job_id uuid not null references jobs(id) on delete cascade,
  -- input
  input_source text not null,         -- 'search', 'csv', 'named'
  input_name text,
  input_company text,
  input_linkedin_url text,
  -- enrichment
  status text not null default 'pending' check (status in ('pending','enriching','researching','drafting','completed','failed')),
  company_domain text,
  company_data jsonb,                 -- scraped from company site
  recent_news jsonb,                  -- scraped news mentions
  email text,
  email_source text check (email_source in ('extracted','pattern_guessed','none')),
  email_confidence text check (email_confidence in ('valid','risky','invalid','unknown')),
  -- AI outputs
  research_summary text,
  email_subject text,
  email_body text,
  talking_points jsonb,
  -- meta
  error_reason text,
  cost_cents int default 0,
  created_at timestamptz not null default now(),
  completed_at timestamptz
);
create index on prospects(job_id);
create index on prospects(status);

-- Scrape cache (the most important table for unit economics)
create table scrape_cache (
  cache_key text primary key,         -- sha256(scrape_type + normalized_url)
  scrape_type text not null,          -- 'company_site' | 'news' | 'search'
  payload jsonb not null,
  fetched_at timestamptz not null default now(),
  expires_at timestamptz not null
);
create index on scrape_cache(expires_at);

-- Credit ledger
create table credit_transactions (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references users(id) on delete cascade,
  delta int not null,
  reason text not null,
  job_id uuid references jobs(id),
  created_at timestamptz not null default now()
);

-- Webhook idempotency
create table webhook_events (
  id text primary key,
  provider text not null,
  payload jsonb not null,
  processed_at timestamptz not null default now()
);

-- RLS
alter table users enable row level security;
alter table jobs enable row level security;
alter table prospects enable row level security;
alter table chat_sessions enable row level security;
alter table chat_messages enable row level security;
alter table prospect_candidates enable row level security;

create policy "own user row" on users for select using (auth.uid() = id);
create policy "own jobs" on jobs for select using (auth.uid() = user_id);
create policy "own prospects" on prospects for select
  using (exists (select 1 from jobs j where j.id = prospects.job_id and j.user_id = auth.uid()));
create policy "own sessions" on chat_sessions for select using (auth.uid() = user_id);
