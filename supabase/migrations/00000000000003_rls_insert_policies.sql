-- 0002: add missing insert/update rls policies
-- the initial schema (0001) only had select policies but sign-in needs
-- to upsert the user row, and the chat + jobs flows need to write rows.

-- users: allow insert and update on own row
drop policy if exists "users can insert own row" on users;
create policy "users can insert own row" on users
  for insert with check (auth.uid() = id);

drop policy if exists "users can update own row" on users;
create policy "users can update own row" on users
  for update using (auth.uid() = id);

-- chat sessions: allow insert
drop policy if exists "own sessions insert" on chat_sessions;
create policy "own sessions insert" on chat_sessions
  for insert with check (auth.uid() = user_id);

drop policy if exists "own sessions update" on chat_sessions;
create policy "own sessions update" on chat_sessions
  for update using (auth.uid() = user_id);

-- chat messages: allow insert (check ownership via session)
drop policy if exists "own messages insert" on chat_messages;
create policy "own messages insert" on chat_messages
  for insert with check (
    exists (
      select 1 from chat_sessions s
      where s.id = chat_messages.session_id
        and s.user_id = auth.uid()
    )
  );

-- jobs: allow insert and update
drop policy if exists "own jobs insert" on jobs;
create policy "own jobs insert" on jobs
  for insert with check (auth.uid() = user_id);

drop policy if exists "own jobs update" on jobs;
create policy "own jobs update" on jobs
  for update using (auth.uid() = user_id);

-- prospects: allow insert and update via job ownership
drop policy if exists "own prospects insert" on prospects;
create policy "own prospects insert" on prospects
  for insert with check (
    exists (
      select 1 from jobs j
      where j.id = prospects.job_id
        and j.user_id = auth.uid()
    )
  );

drop policy if exists "own prospects update" on prospects;
create policy "own prospects update" on prospects
  for update using (
    exists (
      select 1 from jobs j
      where j.id = prospects.job_id
        and j.user_id = auth.uid()
    )
  );

-- prospect_candidates: allow insert
drop policy if exists "own candidates insert" on prospect_candidates;
create policy "own candidates insert" on prospect_candidates
  for insert with check (
    exists (
      select 1 from chat_sessions s
      where s.id = prospect_candidates.session_id
        and s.user_id = auth.uid()
    )
  );

-- credit_transactions: allow insert on own row
drop policy if exists "own credit transactions insert" on credit_transactions;
create policy "own credit transactions insert" on credit_transactions
  for insert with check (auth.uid() = user_id);
