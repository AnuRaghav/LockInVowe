-- Persistent company financial model, populated during onboarding.
--
-- One row per (company_id, key): the structured assumptions the onboarding
-- flow collects (current state, goals, planned changes) so the forecasting
-- engine and agent have something durable to read besides raw transactions.
-- Values are stored as jsonb since assumption shapes vary by key
-- (a number for `mrr`, an array of objects for `planned_hires`, etc).

create table public.company_assumptions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  key text not null,
  value jsonb not null,
  -- Where the value came from: "onboarding" (founder-entered), "derived"
  -- (computed from connected data), "founder" (updated later in chat).
  source text not null default 'onboarding' check (source in ('onboarding', 'derived', 'founder')),
  updated_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (company_id, key)
);

create index company_assumptions_company_id_idx on public.company_assumptions (company_id);

create table public.companies (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  onboarding_completed_at timestamptz,
  created_at timestamptz not null default now()
);

alter table public.company_assumptions enable row level security;
alter table public.companies enable row level security;

-- No auth yet (see lib/company/context.ts). Only the service-role key
-- (server-only) may touch these tables until real auth + RLS policies land.
