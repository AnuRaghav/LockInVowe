-- The Semantic Company Model: what the company currently understands about itself.
--
-- The Source Layer answers "what actually happened?". This layer answers a
-- different question - "what does this company believe, plan, intend, and worry
-- about?" - and the two must not be confused. Nothing here is derived from a
-- bank feed; everything here came from a human saying it.
--
-- The representation is deliberately *not* an ontology. There is no subject,
-- no predicate, no object, no entity table, no edge table. A unit of semantic
-- state is a **block**: a cohesive, natural-language account of one meaningful
-- area of the company - hiring, fundraising, financial posture, an enterprise
-- launch, a migration, one important customer. Its meaning lives in its prose.
-- Every column beside `body` exists only to make blocks findable, selectable,
-- current, attributable, and revisable - never to decompose their meaning.
--
-- Two tables, and the split between them is the whole design:
--
--   semantic_blocks            The *current* understanding. One row per topic.
--   semantic_block_revisions   Every understanding ever held. Append-only.
--
-- A company's hiring plan is one block with three revisions, not three
-- competing memories. That is what lets "what is our hiring plan?" and "how has
-- the hiring plan changed?" both be answered honestly.

-- Lifecycle. Which of these count as "current" is a read-time policy
-- (lib/semantic/types.ts), not a fact about the row.
--
--   active    Live understanding. Eligible for Sam's context.
--   dormant   Still true, not pressing. Retrievable, rarely volunteered.
--   resolved  The topic concluded - the launch shipped, the raise closed.
--   archived  Superseded or no longer meaningful. Kept only for history.
create type public.semantic_block_status as enum (
  'active',
  'dormant',
  'resolved',
  'archived'
);

-- How eagerly a block should reach the model. This is a *context-selection*
-- policy, not an importance score: `always` means "a founder conversation is
-- likely wrong without this", which is a much stronger claim than high salience.
create type public.semantic_context_policy as enum (
  'always',
  'when_relevant',
  'background'
);

-- Why a revision exists. The distinction that earns its keep is `revised` (the
-- company changed) versus `corrected` (we had it wrong): only the first is a
-- real change in the business, and a history rendered for a founder should not
-- present a typo fix as a change of plan.
create type public.semantic_change_kind as enum (
  'created',
  'revised',
  'corrected',
  'status_changed',
  'archived'
);

-- The searchable document a block reduces to.
--
-- A generated column may only call immutable functions, and `array_to_string`
-- is merely stable (its output depends on a type's output function). It is
-- genuinely deterministic for `text[]`, so wrapping the whole expression in an
-- immutable function is the honest way to say so - and it keeps the weighting
-- in one place, which matters because changing it means reindexing.
--
-- Weights: title A, summary and labels B, body C. A query matching a block's
-- title outranks one that merely brushes its body, which is what makes
-- "hiring" find the Hiring block rather than every block mentioning headcount.
create or replace function public.semantic_block_document(
  p_title text,
  p_summary text,
  p_labels text[],
  p_body text
)
returns tsvector
language sql
immutable
parallel safe
set search_path = public
as $$
  select setweight(to_tsvector('english', coalesce(p_title, '')), 'A')
      || setweight(to_tsvector('english', coalesce(p_summary, '')), 'B')
      || setweight(to_tsvector('english', coalesce(array_to_string(p_labels, ' '), '')), 'B')
      || setweight(to_tsvector('english', coalesce(p_body, '')), 'C');
$$;

-- The current understanding of one topic.
--
-- The content columns here are a projection of this block's newest revision -
-- `current_revision_id` names it - and they are only ever written by
-- `semantic_block_revise()`, which writes both in one statement. Nothing else
-- may update this table, which is what stops the head and the history from
-- drifting apart.
create table public.semantic_blocks (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  -- Stable, human-meaningful identity: 'hiring', 'fundraising',
  -- 'customer-acme'. The addressable name of the topic, so a revision six
  -- months from now lands on the same block rather than beside it. Companies
  -- develop their own; nothing is predefined.
  key text not null check (key ~ '^[a-z0-9][a-z0-9_-]{1,63}$'),
  title text not null,
  -- One line, for when the full body is too much to include. Optional: a block
  -- is complete without it.
  summary text,
  -- The understanding itself, in prose. This is the field that carries meaning.
  body text not null,
  -- Free-form retrieval tags. Not a taxonomy - no list is enforced, and a label
  -- means only what the company means by it.
  labels text[] not null default '{}',
  status public.semantic_block_status not null default 'active',
  context_policy public.semantic_context_policy not null default 'when_relevant',
  -- How load-bearing this is for the company, 0-1. Ranks retrieval and decides
  -- what is worth a place in the company brief.
  salience numeric(3, 2) not null default 0.50
    check (salience >= 0 and salience <= 1),
  -- How sure the company is, 0-1. Null means "not stated" - which is different
  -- from "uncertain" and must not be flattened into it.
  confidence numeric(3, 2) check (confidence >= 0 and confidence <= 1),
  -- The date this understanding is about, as opposed to the date it was
  -- recorded (`recorded_at` on the revision). A founder describing a Q4 hiring
  -- plan in September has an `as_of` in September and a plan about December.
  as_of date,
  -- Where this came from: {kind, actor, interactionId, threadId, note, ...}.
  -- A reference, never a transcript. See lib/semantic/types.ts.
  provenance jsonb not null default '{}'::jsonb,
  -- Extension point. Anything a future reader needs that does not deserve a
  -- column yet goes here, so adding it never migrates this table.
  attributes jsonb not null default '{}'::jsonb,
  -- Monotonic revision counter, 1-based. Equals the newest revision's number.
  revision integer not null default 0 check (revision >= 0),
  current_revision_id uuid,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  -- Retrieval without embeddings. See semantic_block_document() above.
  search tsvector generated always as (
    public.semantic_block_document(title, summary, labels, body)
  ) stored,
  -- One block per topic per company. This is the constraint that makes
  -- consolidation the default and "append another memory" impossible.
  unique (company_id, key),
  -- Redundant against the primary key, but required as the target of the
  -- composite foreign key below, which is what stops a revision from ever
  -- being attributed to a different company than its block.
  unique (id, company_id)
);

create index semantic_blocks_company_status_idx
  on public.semantic_blocks (company_id, status, salience desc);

create index semantic_blocks_search_idx
  on public.semantic_blocks using gin (search);

create index semantic_blocks_labels_idx
  on public.semantic_blocks using gin (labels);

-- Every understanding the company has ever held, in order.
--
-- Each row is a full snapshot, not a delta: reconstructing what was believed in
-- October is a lookup, never a replay. Storage is cheap; a history you have to
-- compute is not trustworthy at 3am.
create table public.semantic_block_revisions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  block_id uuid not null,
  revision integer not null check (revision >= 1),
  title text not null,
  summary text,
  body text not null,
  labels text[] not null default '{}',
  status public.semantic_block_status not null,
  context_policy public.semantic_context_policy not null,
  salience numeric(3, 2) not null,
  confidence numeric(3, 2),
  as_of date,
  provenance jsonb not null default '{}'::jsonb,
  attributes jsonb not null default '{}'::jsonb,
  change_kind public.semantic_change_kind not null,
  -- Why the understanding changed, in one line: "Hiring frozen until the raise
  -- closes." This is what a history reads as, and it is the reason a founder
  -- can be shown *why* rather than just a diff.
  change_note text,
  supersedes_revision_id uuid references public.semantic_block_revisions (id),
  -- When we learned it. Together with `as_of` this is the bitemporal pair:
  -- what was true, and when we came to believe it.
  recorded_at timestamptz not null default now(),
  -- When the next revision replaced this one; null while it is current. Stored
  -- rather than derived so "what did we believe on 12 October?" is a range
  -- query and a rendered history can state an interval.
  superseded_at timestamptz,
  foreign key (block_id, company_id)
    references public.semantic_blocks (id, company_id) on delete cascade,
  unique (block_id, revision),
  unique (id, company_id)
);

create index semantic_block_revisions_block_idx
  on public.semantic_block_revisions (block_id, revision desc);

create index semantic_block_revisions_timeline_idx
  on public.semantic_block_revisions (block_id, recorded_at desc);

alter table public.semantic_blocks
  add constraint semantic_blocks_current_revision_fkey
  foreign key (current_revision_id)
  references public.semantic_block_revisions (id) on delete set null;

-- History that can be edited is not history.
--
-- Two exceptions, both narrow:
--
-- `superseded_at` may change, because it is closed out by the revision that
-- replaces this one and says nothing about what was believed.
--
-- A revision may be deleted *only* as part of deleting its block. Removing one
-- revision from under a living block would rewrite the past; removing a topic
-- entirely, along with everything ever understood about it, is a legitimate
-- act - erasing a company's data, say - and must stay possible. By the time a
-- cascade reaches here the parent row is already gone, which is exactly the
-- test below.
create or replace function public.semantic_revision_is_immutable()
returns trigger
language plpgsql
as $$
begin
  if tg_op = 'DELETE' then
    if exists (select 1 from public.semantic_blocks b where b.id = old.block_id) then
      raise exception
        'semantic_block_revisions is append-only; revision % cannot be deleted while its block exists', old.id
        using errcode = 'restrict_violation';
    end if;

    return old;
  end if;

  if (to_jsonb(new) - 'superseded_at') is distinct from (to_jsonb(old) - 'superseded_at') then
    raise exception 'semantic_block_revisions is append-only; only superseded_at may change on revision %', old.id
      using errcode = 'restrict_violation';
  end if;

  return new;
end;
$$;

create trigger semantic_block_revisions_immutable
  before update or delete on public.semantic_block_revisions
  for each row execute function public.semantic_revision_is_immutable();

-- The only writer.
--
-- Creating a block and revising one are the same operation deliberately: the
-- caller states what the company now understands about a topic, and this
-- decides whether that is the first revision or the fourth. A caller cannot
-- accidentally start a second Hiring block, and cannot update the head without
-- also writing the history, because both happen here in one statement.
--
-- supabase-js has no transaction API, so this lives in the database rather than
-- in TypeScript. That is the whole reason it is a function: atomicity, not a
-- preference for SQL.
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
  -- Backdating, for seeding and for importing a history that already happened.
  -- Must move forward: a timeline that can be written out of order is not one.
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
begin
  insert into public.semantic_blocks (company_id, key, title, body)
  values (p_company_id, p_key, p_title, p_body)
  on conflict (company_id, key) do nothing;

  -- Serialize concurrent revisions of the same topic, so two interactions
  -- landing at once produce revisions 4 and 5 rather than two number 4s.
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
    change_kind, change_note, supersedes_revision_id, recorded_at
  )
  values (
    p_company_id, v_block.id, v_revision, p_title, p_summary, p_body,
    coalesce(p_labels, '{}'), p_status, p_context_policy,
    coalesce(p_salience, 0.50), p_confidence, p_as_of,
    coalesce(p_provenance, '{}'::jsonb), coalesce(p_attributes, '{}'::jsonb),
    v_change_kind, p_change_note, v_previous.id, v_recorded_at
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

-- Relevance ranking, in the database.
--
-- The query text is turned into an OR of prefix-matched lexemes rather than the
-- AND that `websearch_to_tsquery` would produce: a founder asking "can we
-- afford another engineer?" should reach the Hiring block on the strength of
-- one word, not fail because the block never says "afford". Postgres does the
-- stemming and stop-word removal, so "hiring", "hire", and "hires" collapse
-- without a word list living in TypeScript.
--
-- With no query text this degrades into "the most load-bearing current state
-- first", which is exactly what a new conversation should open with.
create or replace function public.semantic_block_search(
  p_company_id uuid,
  p_text text default null,
  p_statuses public.semantic_block_status[] default array['active', 'dormant']::public.semantic_block_status[],
  p_labels text[] default null,
  p_limit integer default 5
)
returns setof public.semantic_blocks
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
  from public.semantic_blocks b
  where b.company_id = p_company_id
    and (p_statuses is null or b.status = any (p_statuses))
    and (p_labels is null or b.labels && p_labels)
    and (v_query is null or b.search @@ v_query)
  order by
    case when v_query is null then 0 else ts_rank_cd(b.search, v_query) end desc,
    (b.context_policy = 'always') desc,
    b.salience desc,
    b.updated_at desc
  limit greatest(coalesce(p_limit, 5), 1);
end;
$$;

alter table public.semantic_blocks enable row level security;
alter table public.semantic_block_revisions enable row level security;

-- No auth yet (see lib/company/context.ts), so no policies: RLS with zero
-- policies denies every anon and authenticated request. Only the service-role
-- key, used server-side, may touch these tables until real auth lands. The
-- functions above are `security invoker` on purpose - they must not become a
-- way around that.
