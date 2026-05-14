-- 0002: add missing insert/update rls policies
-- the initial schema (0001) only had select policies but sign-in needs
-- to upsert the user row, and the chat + jobs flows need to write rows.

-- users: allow insert and update on own row
create policy "users can insert own row" on users
  for insert with check (auth.uid() = id);

create policy "users can update own row" on users
  for update using (auth.uid() = id);

-- chat sessions: allow insert
create policy "own sessions insert" on chat_sessions
  for insert with check (auth.uid() = user_id);

create policy "own sessions update" on chat_sessions
  for update using (auth.uid() = user_id);

-- chat messages: allow insert (check ownership via session)
create policy "own messages insert" on chat_messages
  for insert with check (
    exists (
      select 1 from chat_sessions s
      where s.id = chat_messages.session_id
        and s.user_id = auth.uid()
    )
  );

-- jobs: allow insert and update
create policy "own jobs insert" on jobs
  for insert with check (auth.uid() = user_id);

create policy "own jobs update" on jobs
  for update using (auth.uid() = user_id);

-- prospects: allow insert and update via job ownership
create policy "own prospects insert" on prospects
  for insert with check (
    exists (
      select 1 from jobs j
      where j.id = prospects.job_id
        and j.user_id = auth.uid()
    )
  );

create policy "own prospects update" on prospects
  for update using (
    exists (
      select 1 from jobs j
      where j.id = prospects.job_id
        and j.user_id = auth.uid()
    )
  );

-- prospect_candidates: allow insert
create policy "own candidates insert" on prospect_candidates
  for insert with check (
    exists (
      select 1 from chat_sessions s
      where s.id = prospect_candidates.session_id
        and s.user_id = auth.uid()
    )
  );

-- credit_transactions: allow insert on own row
create policy "own credit transactions insert" on credit_transactions
  for insert with check (auth.uid() = user_id);
