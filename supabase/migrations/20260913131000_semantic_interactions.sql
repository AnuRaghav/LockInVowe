-- Semantic consolidation: what caused the company's understanding to change.
--
-- A revision without a cause is an assertion nobody can check. This table is
-- the cause: one row per interaction the semantic updater has considered -
-- usually a conversation, later possibly a document or a founder's note.
--
-- It holds the transcript *once*. Blocks reference it by id rather than
-- carrying excerpts, so a topic revised by five conversations accumulates five
-- references, not five copies of five conversations. That distinction is what
-- keeps a block's `body` about the company instead of about its own history.
--
-- The row is also the audit trail for the updater itself: the model's raw
-- proposal and what deterministic application actually did with it are both
-- recorded, so a bad revision can be traced back to the exact proposal that
-- produced it - and to whether the model or the validator was at fault.

create type public.semantic_interaction_status as enum (
  'pending',
  'processed',
  'skipped',
  'failed'
);

create table public.semantic_interactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  -- Caller-supplied idempotency key: a Sam run id, a message id, a digest of
  -- the transcript. Re-submitting the same interaction must not produce a
  -- second round of revisions, and this is what makes that cheap to enforce
  -- without re-asking the model.
  external_key text not null,
  -- Where the interaction came from: 'conversation', 'note', 'onboarding'.
  -- A plain string, not an enum - the set of things that can teach us something
  -- about a company is not one we can enumerate in advance.
  source text not null default 'conversation',
  thread_id text,
  run_id text,
  occurred_at timestamptz not null default now(),
  -- The interaction itself: [{role, text}, ...]. Stored here and nowhere else.
  transcript jsonb not null default '[]'::jsonb,
  status public.semantic_interaction_status not null default 'pending',
  -- Exactly what the model proposed, before validation. Kept even when the
  -- proposal was rejected: a proposal the validator threw out is the most
  -- interesting record this table holds.
  proposal jsonb,
  -- What application actually did: which blocks were created, revised,
  -- archived, and which operations were refused and why.
  outcome jsonb,
  error text,
  processed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (company_id, external_key),
  unique (id, company_id)
);

create index semantic_interactions_company_idx
  on public.semantic_interactions (company_id, occurred_at desc);

-- A typed, referential link from a revision to its cause. `provenance` already
-- carries a description of where a revision came from; this is the half that a
-- foreign key can defend and a join can follow.
alter table public.semantic_block_revisions
  add column source_interaction_id uuid
    references public.semantic_interactions (id) on delete set null;

create index semantic_block_revisions_interaction_idx
  on public.semantic_block_revisions (source_interaction_id)
  where source_interaction_id is not null;

-- Same signature, so this replaces the function rather than overloading it.
-- The interaction id is read out of `provenance` instead of being added as a
-- seventeenth parameter: provenance is already the designed home for "where did
-- this come from", and a caller that sets it gets the typed column for free.
create or replace function public.semantic_block_revise(
  p_company_id uuid,
  p_key text,
  p_title text,
  p_body text,
  p_summary text default null,
  p_labels text[] default '{}',
  p_status public.semantic_block_status default 'active',
  p_context_policy public.semantic_context_policy default 'when_relevant',
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
  v_block public.semantic_blocks%rowtype;
  v_created boolean := false;
  v_revision integer;
  v_recorded_at timestamptz := coalesce(p_recorded_at, now());
  v_previous public.semantic_block_revisions%rowtype;
  v_change_kind public.semantic_change_kind;
  v_revision_id uuid;
  v_interaction_id uuid;
begin
  -- A malformed id is the caller's bug, but it must not be allowed to look like
  -- "no interaction": fail loudly rather than silently dropping the provenance.
  if coalesce(p_provenance, '{}'::jsonb) ? 'interactionId'
     and nullif(p_provenance ->> 'interactionId', '') is not null then
    v_interaction_id := (p_provenance ->> 'interactionId')::uuid;
  end if;

  insert into public.semantic_blocks (company_id, key, title, body)
  values (p_company_id, p_key, p_title, p_body)
  on conflict (company_id, key) do nothing;

  select * into v_block
  from public.semantic_blocks b
  where b.company_id = p_company_id and b.key = p_key
  for update;

  v_created := v_block.revision = 0;
  v_revision := v_block.revision + 1;

  -- Aliased and qualified throughout: this function's OUT parameters are named
  -- `block_id` and `revision`, which are also column names here, and PL/pgSQL
  -- treats that collision as an error rather than guessing.
  select * into v_previous
  from public.semantic_block_revisions r
  where r.block_id = v_block.id
  order by r.revision desc
  limit 1;

  if v_previous.id is not null and v_recorded_at < v_previous.recorded_at then
    raise exception
      'semantic history moves forward: revision % recorded at % precedes revision % at %',
      v_revision, v_recorded_at, v_previous.revision, v_previous.recorded_at
      using errcode = 'check_violation';
  end if;

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

  insert into public.semantic_block_revisions (
    company_id, block_id, revision, title, summary, body, labels, status,
    context_policy, salience, confidence, as_of, provenance, attributes,
    change_kind, change_note, supersedes_revision_id, recorded_at,
    source_interaction_id
  )
  values (
    p_company_id, v_block.id, v_revision, p_title, p_summary, p_body,
    coalesce(p_labels, '{}'), p_status, p_context_policy,
    coalesce(p_salience, 0.50), p_confidence, p_as_of,
    coalesce(p_provenance, '{}'::jsonb), coalesce(p_attributes, '{}'::jsonb),
    v_change_kind, p_change_note, v_previous.id, v_recorded_at,
    v_interaction_id
  )
  returning id into v_revision_id;

  if v_previous.id is not null then
    update public.semantic_block_revisions r
    set superseded_at = v_recorded_at
    where r.id = v_previous.id;
  end if;

  update public.semantic_blocks b
  set title = p_title,
      summary = p_summary,
      body = p_body,
      labels = coalesce(p_labels, '{}'),
      status = p_status,
      context_policy = p_context_policy,
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

alter table public.semantic_interactions enable row level security;
