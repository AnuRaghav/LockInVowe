-- Conversation identity is independent of company setup. company_id is only
-- the existing application scope for server-side access checks (no new company model).
create table public.conversation_threads (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  name text check (name is null or length(btrim(name)) > 0),
  created_at timestamptz not null default now()
);
create index conversation_threads_company_idx on public.conversation_threads(company_id);

create table public.conversation_messages (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.conversation_threads(id) on delete cascade,
  role text not null check (role in ('user', 'assistant')),
  content text not null check (length(btrim(content)) > 0),
  created_at timestamptz not null default clock_timestamp(),
  -- Timestamps describe when; this internal key makes ordering unambiguous.
  position bigint generated always as identity,
  unique(thread_id, position),
  unique(thread_id, id)
);

create table public.conversation_runs (
  id uuid primary key default gen_random_uuid(),
  thread_id uuid not null references public.conversation_threads(id) on delete cascade,
  user_message_id uuid not null unique,
  status text not null default 'running' check (status in ('running', 'completed', 'failed', 'cancelled')),
  started_at timestamptz not null default clock_timestamp(),
  finished_at timestamptz,
  foreign key (thread_id, user_message_id) references public.conversation_messages(thread_id, id),
  check ((status = 'running') = (finished_at is null))
);
create index conversation_runs_thread_idx on public.conversation_runs(thread_id);
create unique index conversation_runs_one_running on public.conversation_runs(thread_id) where status = 'running';

alter table public.conversation_threads enable row level security;
alter table public.conversation_messages enable row level security;
alter table public.conversation_runs enable row level security;
-- Same server-only access as the existing source/semantic stores. No browser policies.
revoke all on public.conversation_threads, public.conversation_messages, public.conversation_runs from public, anon, authenticated;
grant select, insert, update, delete on public.conversation_threads, public.conversation_messages, public.conversation_runs to service_role;
grant usage, select on sequence public.conversation_messages_position_seq to service_role;

-- User message and run become visible together. The lock lasts only this transaction,
-- never the model call. An unknown supplied thread ID must not create a new thread.
create function public.conversation_begin(p_company_id uuid, p_content text, p_thread_id uuid default null)
returns public.conversation_runs
language plpgsql security invoker set search_path = '' as $$
declare
  v_thread uuid;
  v_message uuid;
  v_run public.conversation_runs;
begin
  if p_thread_id is null then
    insert into public.conversation_threads(company_id) values (p_company_id) returning id into v_thread;
  else
    select id into v_thread from public.conversation_threads
      where id = p_thread_id and company_id = p_company_id for update;
    if not found then raise sqlstate 'PT404' using message = 'Thread not found'; end if;
  end if;
  if exists (select 1 from public.conversation_runs where thread_id = v_thread and status = 'running') then
    raise sqlstate 'PT409' using message = 'Thread already has a running turn';
  end if;
  insert into public.conversation_messages(thread_id, role, content)
    values (v_thread, 'user', p_content) returning id into v_message;
  insert into public.conversation_runs(thread_id, user_message_id)
    values (v_thread, v_message) returning * into v_run;
  return v_run;
end;
$$;

-- Only a completed run gets an assistant message. Repeated finalization is a no-op.
create function public.conversation_finish(p_company_id uuid, p_run_id uuid, p_status text, p_content text default null)
returns void
language plpgsql security invoker set search_path = '' as $$
declare v_run public.conversation_runs;
begin
  select r.* into v_run from public.conversation_runs r
    join public.conversation_threads t on t.id = r.thread_id
    where r.id = p_run_id and t.company_id = p_company_id for update of r;
  if not found then raise sqlstate 'PT404' using message = 'Run not found'; end if;
  if p_status is null or p_status not in ('completed', 'failed', 'cancelled') then
    raise exception 'Invalid terminal status';
  end if;
  if v_run.status <> 'running' then return; end if;
  if p_status = 'completed' then
    insert into public.conversation_messages(thread_id, role, content)
      values (v_run.thread_id, 'assistant', p_content);
  end if;
  update public.conversation_runs set status = p_status, finished_at = clock_timestamp() where id = p_run_id;
end;
$$;

revoke execute on function public.conversation_begin(uuid, text, uuid), public.conversation_finish(uuid, uuid, text, text) from public, anon, authenticated;
grant execute on function public.conversation_begin(uuid, text, uuid), public.conversation_finish(uuid, uuid, text, text) to service_role;
