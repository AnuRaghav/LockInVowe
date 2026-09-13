-- Payroll data connector (Gusto). Mirrors the bank_connections shape from
-- supabase/migrations/20260913025944_bank_connectors.sql: one connection per
-- linked company, child tables for the normalized data it provides.
--
-- Gusto is OAuth2, so a connection also stores a refresh token and the
-- access token's expiry, unlike Plaid's long-lived access token.

create table public.payroll_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  provider text not null default 'gusto' check (provider in ('gusto')),
  -- Gusto company UUID (the sandbox demo company, for the MVP).
  provider_company_id text not null,
  access_token text not null,
  refresh_token text not null,
  access_token_expires_at timestamptz not null,
  status text not null default 'active' check (status in ('active', 'error', 'revoked')),
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_company_id)
);

create index payroll_connections_company_id_idx on public.payroll_connections (company_id);

create table public.payroll_employees (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  payroll_connection_id uuid not null references public.payroll_connections (id) on delete cascade,
  provider_employee_id text not null,
  first_name text,
  last_name text,
  title text,
  department text,
  employment_status text,
  -- Current compensation snapshot; history lives in payroll_runs line items.
  annual_salary_usd numeric(14, 2),
  hourly_rate_usd numeric(10, 2),
  payment_unit text check (payment_unit in ('year', 'hour')),
  start_date date,
  termination_date date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_connection_id, provider_employee_id)
);

create index payroll_employees_company_id_idx on public.payroll_employees (company_id);

create table public.payroll_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  payroll_connection_id uuid not null references public.payroll_connections (id) on delete cascade,
  provider_payroll_id text not null,
  pay_period_start date not null,
  pay_period_end date not null,
  check_date date not null,
  -- Sum across every employee in this run: gross pay, employer taxes, benefits.
  total_gross_pay_usd numeric(14, 2) not null,
  total_employer_cost_usd numeric(14, 2) not null,
  processed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (payroll_connection_id, provider_payroll_id)
);

create index payroll_runs_company_id_idx on public.payroll_runs (company_id);
create index payroll_runs_check_date_idx on public.payroll_runs (check_date);

alter table public.payroll_connections enable row level security;
alter table public.payroll_employees enable row level security;
alter table public.payroll_runs enable row level security;

-- No auth yet (see lib/company/context.ts). Only the service-role key
-- (server-only) may touch these tables until real auth + RLS policies land.
