-- =====================================================================
-- 0002_auth.sql — identity moves out of Supabase Auth
--
-- public.users used to be a mirror of auth.users:
--     id uuid primary key references auth.users(id) on delete cascade
-- The auth schema does not exist on Railway, so public.users becomes the
-- real identity table and must carry the credentials itself.
--
-- ADDITIVE + IDEMPOTENT.
-- =====================================================================

-- 1. Drop the dependency on the Supabase auth schema, if present.
do $$
declare cname text;
begin
  select conname into cname
    from pg_constraint
   where conrelid = 'public.users'::regclass
     and contype = 'f'
     and confrelid::regclass::text like 'auth.%';
  if cname is not null then
    execute format('alter table public.users drop constraint %I', cname);
    raise notice 'dropped auth.users FK: %', cname;
  end if;
exception
  when undefined_table then null;
end $$;

-- id is now self-sovereign, so it needs its own default.
alter table public.users
  alter column id set default gen_random_uuid();

-- 2. Credentials.
--    scrypt output: scrypt$<N>$<salt b64>$<key b64>. NULL for accounts
--    that only ever signed in with Google.
alter table public.users
  add column if not exists password_hash text;

--    Google's stable subject id. Never match on email alone for OAuth —
--    an email can be reassigned, `sub` cannot.
alter table public.users
  add column if not exists google_sub text;

alter table public.users
  add column if not exists last_login_at timestamptz;

create unique index if not exists users_google_sub_idx
  on public.users(google_sub)
  where google_sub is not null;

create unique index if not exists users_email_lower_idx
  on public.users(lower(email));

-- 3. NO "must have a credential" CHECK constraint.
--
--    An earlier draft added:
--      check (password_hash is not null or google_sub is not null)
--
--    It was removed after testing. Postgres validates the proposed tuple
--    of an INSERT ... ON CONFLICT DO UPDATE before conflict resolution,
--    so the constraint rejects every user upsert that does not restate a
--    credential — and this app upserts `{id, email}` without credentials
--    in three places: app/api/auth/callback, app/login, app/api/chat.
--
--    A constraint that breaks working code paths to guard a case the auth
--    layer already prevents (signUp always writes a hash; Google sign-in
--    always writes google_sub) is a bad trade. Enforced in lib/db/auth.ts.
alter table public.users
  drop constraint if exists users_has_credential;

-- 4. RLS is gone on Railway. Drop the policies that referenced auth.uid()
--    so they cannot be mistaken for live protection.
--
--    Ownership is now enforced in lib/db/rls.ts, injected by
--    lib/db/query-builder.ts into every user-scoped statement.
do $$
declare r record;
begin
  for r in
    select schemaname, tablename, policyname
      from pg_policies
     where schemaname = 'public'
  loop
    execute format('drop policy if exists %I on %I.%I',
                   r.policyname, r.schemaname, r.tablename);
  end loop;

  for r in
    select tablename from pg_tables where schemaname = 'public'
  loop
    execute format('alter table public.%I disable row level security', r.tablename);
  end loop;
end $$;
