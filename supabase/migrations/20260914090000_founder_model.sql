-- The Founder Model: who the person running the company is.
--
-- The Semantic Company Model answers "what does this company believe and
-- intend?". This answers a different question - "who is this founder, what do
-- they care about, and how do they want to be worked with?" - and it belongs to
-- the person, not the company. A co-founder joining later gets their own rows
-- here; they do not inherit, read, or overwrite the first founder's.
--
-- So everything here is scoped by `founder_id` (the authenticated user id) and
-- never by `company_id`. There is deliberately no foreign key to `auth.users`:
-- the company tables do not have one either, and dev/integration scopes use ids
-- that are not real accounts.
--
-- Two shapes, for two kinds of knowledge:
--
--   founder_blocks (+ revisions)   Prose, like semantic blocks: background,
--                                  motivation, values, non-negotiables,
--                                  decision style, personal constraints.
--   founder_communication_contract_revisions
--                                  A small typed record Sam's behaviour
--                                  branches on: how to deliver bad news, how
--                                  much detail, when to raise alarms.
--
-- The typed half is the exception to "no taxonomy" and has to earn it: prose is
-- retrieved by relevance, and how to tell this person their runway just dropped
-- cannot depend on whether a search happened to match.

-- How carefully a block must be handled.
--
--   standard   About the founder, usable wherever that founder is being served.
--   personal   Sensitive (salary, personal runway, personal money in the
--              company). Excluded from every read unless the caller asks for it
--              explicitly, and never allowed to become `standard` again.
create type public.founder_block_sensitivity as enum ('standard', 'personal');

create table public.founder_blocks (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null,
  key text not null check (key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  title text not null,
  summary text,
  body text not null,
  labels text[] not null default '{}',
  -- Same lifecycle as semantic blocks; `CURRENT_STATUSES` applies unchanged.
  status public.semantic_block_status not null default 'active',
  sensitivity public.founder_block_sensitivity not null default 'standard',
  salience numeric(3, 2) not null default 0.50
    check (salience >= 0 and salience <= 1),
  confidence numeric(3, 2) check (confidence >= 0 and confidence <= 1),
  as_of date,
  provenance jsonb not null default '{}'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  revision integer not null default 0 check (revision >= 0),
  current_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  search tsvector generated always as (
    public.semantic_block_document(title, summary, labels, body)
  ) stored,
  unique (founder_id, key),
  unique (id, founder_id)
);

create index founder_blocks_founder_status_idx
  on public.founder_blocks (founder_id, status, salience desc);

create index founder_blocks_search_idx
  on public.founder_blocks using gin (search);

create table public.founder_block_revisions (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null,
  block_id uuid not null,
  revision integer not null check (revision >= 1),
  title text not null,
  summary text,
  body text not null,
  labels text[] not null default '{}',
  status public.semantic_block_status not null,
  sensitivity public.founder_block_sensitivity not null,
  salience numeric(3, 2) not null,
  confidence numeric(3, 2),
  as_of date,
  provenance jsonb not null default '{}'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  change_kind public.semantic_change_kind not null,
  change_note text,
  supersedes_revision_id uuid references public.founder_block_revisions (id),
  recorded_at timestamptz not null default now(),
  superseded_at timestamptz,
  -- Deleting a block takes its whole history with it. Unlike company semantic
  -- state, a founder's account of themselves is theirs to erase.
  foreign key (block_id, founder_id)
    references public.founder_blocks (id, founder_id) on delete cascade,
  unique (block_id, revision),
  unique (id, founder_id)
);

create index founder_block_revisions_block_idx
  on public.founder_block_revisions (block_id, revision desc);

alter table public.founder_blocks
  add constraint founder_blocks_current_revision_fkey
  foreign key (current_revision_id)
  references public.founder_block_revisions (id) on delete set null;

-- History is append-only while its block exists; erasing the block erases it.
create or replace function public.founder_revision_is_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.founder_blocks b where b.id = old.block_id) then
      raise exception
        'founder_block_revisions is append-only; revision % cannot be deleted while its block exists', old.id
        using errcode = 'restrict_violation';
    end if;

    return old;
  end if;

  if (to_jsonb(new) - 'superseded_at') is distinct from (to_jsonb(old) - 'superseded_at') then
    raise exception 'founder_block_revisions is append-only; only superseded_at may change on revision %', old.id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger founder_block_revisions_immutable
  before update or delete on public.founder_block_revisions
  for each row execute function public.founder_revision_is_immutable();

-- The only writer, modelled on semantic_block_revise().
--
-- `p_sensitivity` defaults to null, meaning "keep what the block already is", so
-- revising a personal block without restating its sensitivity never quietly
-- downgrades it. An explicit downgrade is refused outright: once something has
-- been treated as personal, making it readable by default is not a revision.
create or replace function public.founder_block_revise(
  p_founder_id uuid,
  p_key text,
  p_title text,
  p_body text,
  p_summary text default null,
  p_labels text[] default '{}',
  p_status public.semantic_block_status default 'active',
  p_sensitivity public.founder_block_sensitivity default null,
  p_salience numeric default 0.50,
  p_confidence numeric default null,
  p_as_of date default null,
  p_provenance jsonb default '{}'::jsonb,
  p_attributes jsonb default '{}'::jsonb,
  p_change_kind public.semantic_change_kind default null,
  p_change_note text default null,
  p_recorded_at timestamptz default null
)
returns table (block_id uuid, revision_id uuid, revision integer, created boolean)
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_block public.founder_blocks%rowtype;
  v_created boolean := false;
  v_revision integer;
  v_recorded_at timestamptz := coalesce(p_recorded_at, now());
  v_previous public.founder_block_revisions%rowtype;
  v_sensitivity public.founder_block_sensitivity;
  v_change_kind public.semantic_change_kind;
  v_revision_id uuid;
begin
  insert into public.founder_blocks (founder_id, key, title, body)
  values (p_founder_id, p_key, p_title, p_body)
  on conflict (founder_id, key) do nothing;

  select * into v_block
  from public.founder_blocks b
  where b.founder_id = p_founder_id and b.key = p_key
  for update;

  v_created := v_block.revision = 0;
  v_revision := v_block.revision + 1;

  select * into v_previous
  from public.founder_block_revisions r
  where r.block_id = v_block.id
  order by r.revision desc
  limit 1;

  if v_previous.id is not null and v_recorded_at < v_previous.recorded_at then
    raise exception
      'founder history moves forward: revision % recorded at % precedes revision % at %',
      v_revision, v_recorded_at, v_previous.revision, v_previous.recorded_at
      using errcode = 'check_violation';
  end if;

  if v_previous.id is not null
     and v_previous.sensitivity = 'personal'
     and p_sensitivity = 'standard' then
    raise exception
      'founder block sensitivity only increases: "%" is personal and cannot become standard', p_key
      using errcode = 'check_violation';
  end if;

  v_sensitivity := coalesce(p_sensitivity, v_previous.sensitivity, 'standard');

  v_change_kind := coalesce(
    p_change_kind,
    case
      when v_created then 'created'::public.semantic_change_kind
      when p_status = 'archived' then 'archived'::public.semantic_change_kind
      when v_previous.id is not null and v_previous.status is distinct from p_status
        then 'status_changed'::public.semantic_change_kind
      else 'revised'::public.semantic_change_kind
    end
  );

  insert into public.founder_block_revisions (
    founder_id, block_id, revision, title, summary, body, labels, status,
    sensitivity, salience, confidence, as_of, provenance, attributes,
    change_kind, change_note, supersedes_revision_id, recorded_at
  )
  values (
    p_founder_id, v_block.id, v_revision, p_title, p_summary, p_body,
    coalesce(p_labels, '{}'), p_status, v_sensitivity,
    coalesce(p_salience, 0.50), p_confidence, p_as_of,
    coalesce(p_provenance, '{}'::jsonb), coalesce(p_attributes, '{}'::jsonb),
    v_change_kind, p_change_note, v_previous.id, v_recorded_at
  )
  returning id into v_revision_id;

  if v_previous.id is not null then
    update public.founder_block_revisions r
    set superseded_at = v_recorded_at
    where r.id = v_previous.id;
  end if;

  update public.founder_blocks b
  set title = p_title,
      summary = p_summary,
      body = p_body,
      labels = coalesce(p_labels, '{}'),
      status = p_status,
      sensitivity = v_sensitivity,
      salience = coalesce(p_salience, 0.50),
      confidence = p_confidence,
      as_of = p_as_of,
      provenance = coalesce(p_provenance, '{}'::jsonb),
      attributes = coalesce(p_attributes, '{}'::jsonb),
      revision = v_revision,
      current_revision_id = v_revision_id,
      created_at = case when v_created then v_recorded_at else v_block.created_at end,
      updated_at = v_recorded_at
  where b.id = v_block.id;

  return query select v_block.id, v_revision_id, v_revision, v_created;
end;
$$;

-- Relevance ranking, as semantic_block_search() does it. Personal blocks are
-- excluded unless `p_include_personal` is set: the safe default lives in SQL so
-- a caller that forgets the flag gets less, never more.
create or replace function public.founder_block_search(
  p_founder_id uuid,
  p_text text default null,
  p_statuses public.semantic_block_status[] default array['active', 'dormant']::public.semantic_block_status[],
  p_labels text[] default null,
  p_include_personal boolean default false,
  p_limit integer default 5
)
returns setof public.founder_blocks
language plpgsql
stable
security invoker
set search_path = public
as $$
declare
  v_query tsquery;
begin
  if p_text is not null and btrim(p_text) <> '' then
    select to_tsquery('english', string_agg(quote_literal(lexeme) || ':*', ' | '))
    into v_query
    from unnest(to_tsvector('english', p_text));
  end if;

  return query
  select b.*
  from public.founder_blocks b
  where b.founder_id = p_founder_id
    and (p_statuses is null or b.status = any (p_statuses))
    and (p_labels is null or b.labels && p_labels)
    and (coalesce(p_include_personal, false) or b.sensitivity = 'standard')
    and (v_query is null or b.search @@ v_query)
  order by
    case when v_query is null then 0 else ts_rank_cd(b.search, v_query) end desc,
    b.salience desc,
    b.updated_at desc
  limit greatest(coalesce(p_limit, 5), 1);
end;
$$;

-- The communication contract, as an append-only series of full snapshots.
--
-- There is no head table: the current contract is the highest revision. With
-- one table there is nothing to drift apart. Every preference column is
-- nullable, and null means "not stated yet" - Sam falls back to its defaults for
-- that one preference rather than guessing one.
create table public.founder_communication_contract_revisions (
  id uuid primary key default gen_random_uuid(),
  founder_id uuid not null,
  revision integer not null check (revision >= 1),
  bad_news text
    check (bad_news in ('lead_with_it', 'context_then_news', 'news_with_options')),
  detail text check (detail in ('headline', 'show_work')),
  recommendations text
    check (recommendations in ('tell_me_what_to_do', 'give_me_options')),
  pushback text check (pushback in ('challenge_hard', 'advisory')),
  flag_optimistic_assumptions boolean,
  finance_fluency text check (finance_fluency in ('plain', 'fluent')),
  -- [{metric, direction, threshold}], validated in lib/founder/contract.ts.
  alerts jsonb not null default '[]'::jsonb check (jsonb_typeof(alerts) = 'array'),
  provenance jsonb not null default '{}'::jsonb,
  change_kind public.semantic_change_kind not null,
  change_note text,
  recorded_at timestamptz not null default now(),
  unique (founder_id, revision)
);

create index founder_contract_revisions_current_idx
  on public.founder_communication_contract_revisions (founder_id, revision desc);

-- Revisions are never edited. Deleting them is allowed: it is how a founder's
-- contract is erased, and it only ever happens server-side.
create or replace function public.founder_contract_revision_is_immutable()
returns trigger
language plpgsql
as $$
begin
  raise exception 'founder_communication_contract_revisions is append-only; revision % cannot be updated', old.id
    using errcode = 'restrict_violation';
end;
$$;

create trigger founder_contract_revisions_immutable
  before update on public.founder_communication_contract_revisions
  for each row execute function public.founder_contract_revision_is_immutable();

-- Applies a partial change to the current contract and records the result.
--
-- A key present in `p_patch` replaces that preference (JSON null clears it); a
-- key absent keeps the previous value. The merge happens here, under a
-- per-founder lock, because onboarding records preferences one answer at a time
-- and a read-merge-write in TypeScript would lose one of two concurrent answers.
create or replace function public.founder_contract_revise(
  p_founder_id uuid,
  p_patch jsonb,
  p_provenance jsonb default '{}'::jsonb,
  p_change_kind public.semantic_change_kind default null,
  p_change_note text default null
)
returns public.founder_communication_contract_revisions
language plpgsql
security invoker
set search_path = public
as $$
declare
  v_previous public.founder_communication_contract_revisions%rowtype;
  v_next public.founder_communication_contract_revisions%rowtype;
  v_unknown text;
begin
  if p_patch is null or jsonb_typeof(p_patch) <> 'object' or p_patch = '{}'::jsonb then
    raise exception 'founder contract patch must be a non-empty object'
      using errcode = 'check_violation';
  end if;

  select k into v_unknown
  from jsonb_object_keys(p_patch) as k
  where k not in (
    'bad_news', 'detail', 'recommendations', 'pushback',
    'flag_optimistic_assumptions', 'finance_fluency', 'alerts'
  )
  limit 1;

  if v_unknown is not null then
    raise exception 'unknown founder contract field "%"', v_unknown
      using errcode = 'check_violation';
  end if;

  perform pg_advisory_xact_lock(hashtextextended('founder_contract:' || p_founder_id::text, 0));

  select * into v_previous
  from public.founder_communication_contract_revisions c
  where c.founder_id = p_founder_id
  order by c.revision desc
  limit 1;

  insert into public.founder_communication_contract_revisions (
    founder_id, revision, bad_news, detail, recommendations, pushback,
    flag_optimistic_assumptions, finance_fluency, alerts, provenance,
    change_kind, change_note
  )
  values (
    p_founder_id,
    coalesce(v_previous.revision, 0) + 1,
    case when p_patch ? 'bad_news' then p_patch ->> 'bad_news' else v_previous.bad_news end,
    case when p_patch ? 'detail' then p_patch ->> 'detail' else v_previous.detail end,
    case when p_patch ? 'recommendations' then p_patch ->> 'recommendations' else v_previous.recommendations end,
    case when p_patch ? 'pushback' then p_patch ->> 'pushback' else v_previous.pushback end,
    case when p_patch ? 'flag_optimistic_assumptions'
      then (p_patch ->> 'flag_optimistic_assumptions')::boolean
      else v_previous.flag_optimistic_assumptions end,
    case when p_patch ? 'finance_fluency' then p_patch ->> 'finance_fluency' else v_previous.finance_fluency end,
    case when p_patch ? 'alerts'
      then coalesce(nullif(p_patch -> 'alerts', 'null'::jsonb), '[]'::jsonb)
      else coalesce(v_previous.alerts, '[]'::jsonb) end,
    coalesce(p_provenance, '{}'::jsonb),
    coalesce(
      p_change_kind,
      case when v_previous.id is null
        then 'created'::public.semantic_change_kind
        else 'revised'::public.semantic_change_kind end
    ),
    p_change_note
  )
  returning * into v_next;

  return v_next;
end;
$$;

alter table public.founder_blocks enable row level security;
alter table public.founder_block_revisions enable row level security;
alter table public.founder_communication_contract_revisions enable row level security;

-- Server-only, as with conversations. No browser policies, and the functions are
-- not callable by anon/authenticated even though RLS would already deny rows.
revoke all on public.founder_blocks, public.founder_block_revisions,
  public.founder_communication_contract_revisions
  from public, anon, authenticated;
grant select, insert, update, delete on public.founder_blocks, public.founder_block_revisions,
  public.founder_communication_contract_revisions
  to service_role;

revoke execute on function
  public.founder_block_revise(uuid, text, text, text, text, text[], public.semantic_block_status, public.founder_block_sensitivity, numeric, numeric, date, jsonb, jsonb, public.semantic_change_kind, text, timestamptz),
  public.founder_block_search(uuid, text, public.semantic_block_status[], text[], boolean, integer),
  public.founder_contract_revise(uuid, jsonb, jsonb, public.semantic_change_kind, text)
  from public, anon, authenticated;
grant execute on function
  public.founder_block_revise(uuid, text, text, text, text, text[], public.semantic_block_status, public.founder_block_sensitivity, numeric, numeric, date, jsonb, jsonb, public.semantic_change_kind, text, timestamptz),
  public.founder_block_search(uuid, text, public.semantic_block_status[], text[], boolean, integer),
  public.founder_contract_revise(uuid, jsonb, jsonb, public.semantic_change_kind, text)
  to service_role;
