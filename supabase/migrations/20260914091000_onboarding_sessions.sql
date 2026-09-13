-- Onboarding sessions: the resumable state of one founder's onboarding interview.
--
-- Scoped by both founder and company, because onboarding is one person telling
-- us about one company. At most one session per pair is in progress at a time;
-- leaving and coming back resumes it rather than starting over.
--
-- The transcript never holds the text of a sensitive answer. Messages from the
-- personal section are stored as `{role, sectionId, sensitive: true, redacted:
-- true}` - enough to know the section happened, nothing that says what was
-- said. What the founder shared there lives only in personal founder blocks.
-- lib/onboarding/sessions.ts redacts before writing; onboarding_session_record()
-- refuses anything that slipped through.

create table public.onboarding_sessions (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null,
  company_id uuid not null,
  status text not null default 'in_progress'
    check (status in ('in_progress', 'completed', 'abandoned')),
  -- Per-question progress, keyed by question id. Its shape is owned by the
  -- interview engine; this table only guarantees it is an object.
  checklist jsonb not null default '{}'::jsonb check (jsonb_typeof(checklist) = 'object'),
  transcript jsonb not null default '[]'::jsonb check (jsonb_typeof(transcript) = 'array'),
  -- Questions answered with "later", "not sure", or "I'd rather not", keyed by
  -- question id: {state: 'deferred'|'unsure'|'declined', at, note?}.
  open_items jsonb not null default '{}'::jsonb check (jsonb_typeof(open_items) = 'object'),
  started_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  check ((status = 'completed') = (completed_at is not null))
);

create index onboarding_sessions_founder_idx
  on public.onboarding_sessions (founder_id, company_id, started_at desc);

create unique index onboarding_sessions_one_in_progress
  on public.onboarding_sessions (founder_id, company_id)
  where status = 'in_progress';

-- Returns the in-progress session, creating it if there is none. Two tabs
-- opening onboarding at once get the same session.
create or replace function public.onboarding_session_start(
  p_founder_id uuid,
  p_company_id uuid
)
returns public.onboarding_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session public.onboarding_sessions%rowtype;
begin
  insert into public.onboarding_sessions (founder_id, company_id)
  values (p_founder_id, p_company_id)
  on conflict (founder_id, company_id) where status = 'in_progress' do nothing;

  select * into v_session
  from public.onboarding_sessions s
  where s.founder_id = p_founder_id
    and s.company_id = p_company_id
    and s.status = 'in_progress';

  return v_session;
end;
$$;

-- Appends transcript messages and merges checklist/open-item changes in one
-- statement, so concurrent answers cannot overwrite each other's progress.
create or replace function public.onboarding_session_record(
  p_session_id uuid,
  p_founder_id uuid,
  p_messages jsonb default '[]'::jsonb,
  p_checklist jsonb default '{}'::jsonb,
  p_open_items jsonb default '{}'::jsonb
)
returns public.onboarding_sessions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_session public.onboarding_sessions%rowtype;
begin
  if jsonb_typeof(coalesce(p_messages, '[]'::jsonb)) <> 'array'
     or jsonb_typeof(coalesce(p_checklist, '{}'::jsonb)) <> 'object'
     or jsonb_typeof(coalesce(p_open_items, '{}'::jsonb)) <> 'object' then
    raise exception 'onboarding session changes have the wrong shape'
      using errcode = 'check_violation';
  end if;

  if exists (
    select 1
    from jsonb_array_elements(coalesce(p_messages, '[]'::jsonb)) as m
    where jsonb_typeof(m) <> 'object'
       or (m ->> 'sensitive' = 'true' and m ? 'text')
  ) then
    raise exception 'sensitive onboarding messages must be redacted before they are stored'
      using errcode = 'check_violation';
  end if;

  update public.onboarding_sessions s
  set transcript = s.transcript || coalesce(p_messages, '[]'::jsonb),
      checklist = s.checklist || coalesce(p_checklist, '{}'::jsonb),
      open_items = s.open_items || coalesce(p_open_items, '{}'::jsonb),
      updated_at = now()
  where s.id = p_session_id
    and s.founder_id = p_founder_id
    and s.status = 'in_progress'
  returning * into v_session;

  if not found then
    raise sqlstate 'PT404' using message = 'Onboarding session not found or not in progress';
  end if;

  return v_session;
end;
$$;

alter table public.onboarding_sessions enable row level security;

revoke all on public.onboarding_sessions from public, anon, authenticated;
grant select, insert, update, delete on public.onboarding_sessions to service_role;

revoke execute on function
  public.onboarding_session_start(uuid, uuid),
  public.onboarding_session_record(uuid, uuid, jsonb, jsonb, jsonb)
  from public, anon, authenticated;
grant execute on function
  public.onboarding_session_start(uuid, uuid),
  public.onboarding_session_record(uuid, uuid, jsonb, jsonb, jsonb)
  to service_role;
