-- The company brief: a compact synthesis of current semantic state.
--
-- Sam opens most conversations needing the same handful of things - how the
-- company is doing financially, what it is trying to do next, what it is
-- worried about. Retrieving that per question is both slower and worse: a
-- founder asking about a hire should not have to mention fundraising for the
-- raise to be in the room.
--
-- So the brief is *baseline* context, and relevance-selected blocks sit on top
-- of it. It is a **materialized projection** of `semantic_blocks`, never a
-- second source of truth: it can always be thrown away and regenerated, and
-- nothing may write to it except the generator.
--
-- Its sections are not a fixed ontology. A company mid-raise deserves a
-- fundraising section; one that has never raised does not. What the state says
-- decides what the brief says.

create table public.company_briefs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  -- Monotonic per company. The highest version is the current brief; earlier
  -- ones are kept because "what did Sam open with when it said that?" is a
  -- question worth being able to answer.
  version integer not null check (version >= 1),
  -- The brief as the model will read it. Deliberately small - hundreds of
  -- tokens, not thousands - and capped in application code.
  body text not null,
  -- The same content as [{heading, body}], so a UI or a future context budget
  -- can drop or reorder sections without re-parsing prose.
  sections jsonb not null default '[]'::jsonb,
  -- Digest of the brief-eligible blocks this was generated from: block id,
  -- revision, status, salience, context policy. Equality here means the inputs
  -- have not moved, which is what makes "regenerate only on material change"
  -- a deterministic test rather than a judgement call.
  fingerprint text not null,
  -- Which blocks actually fed this brief, so a claim in the brief can be traced
  -- back to the block that supports it.
  source_block_ids uuid[] not null default '{}',
  -- How it was produced: {kind: 'model'|'deterministic', model, ...}. A brief
  -- written by the fallback composer must be distinguishable from one a model
  -- synthesized.
  generator jsonb not null default '{}'::jsonb,
  generated_at timestamptz not null default now(),
  unique (company_id, version)
);

create index company_briefs_current_idx
  on public.company_briefs (company_id, version desc);

alter table public.company_briefs enable row level security;
