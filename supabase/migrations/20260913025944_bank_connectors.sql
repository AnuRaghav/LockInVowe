-- Bank data connector tables (Plaid first; Rho later behind the same shape).
--
-- One `bank_connections` row per linked institution (a Plaid "Item"). Access
-- tokens are sensitive and are only ever read/written via the service-role
-- key from server code - never exposed to the browser client.

create table public.bank_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  provider text not null check (provider in ('plaid', 'rho')),
  -- Plaid item_id / Rho equivalent external identifier.
  provider_item_id text not null,
  -- Encrypted at rest by Supabase; still never sent to the client.
  access_token text not null,
  institution_name text,
  status text not null default 'active' check (status in ('active', 'error', 'revoked')),
  -- Plaid `/transactions/sync` cursor; null until the first sync completes.
  sync_cursor text,
  last_synced_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (provider, provider_item_id)
);

create index bank_connections_company_id_idx on public.bank_connections (company_id);

create table public.bank_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  bank_connection_id uuid not null references public.bank_connections (id) on delete cascade,
  provider_account_id text not null,
  name text not null,
  official_name text,
  type text,
  subtype text,
  mask text,
  available_balance_usd numeric(14, 2),
  current_balance_usd numeric(14, 2),
  currency text not null default 'USD',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_connection_id, provider_account_id)
);

create index bank_accounts_company_id_idx on public.bank_accounts (company_id);

create table public.bank_transactions (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  bank_account_id uuid not null references public.bank_accounts (id) on delete cascade,
  provider_transaction_id text not null,
  -- Plaid sign convention: positive = money out, negative = money in.
  amount_usd numeric(14, 2) not null,
  currency text not null default 'USD',
  posted_date date not null,
  name text not null,
  merchant_name text,
  category text,
  pending boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (bank_account_id, provider_transaction_id)
);

create index bank_transactions_company_id_idx on public.bank_transactions (company_id);
create index bank_transactions_posted_date_idx on public.bank_transactions (posted_date);

alter table public.bank_connections enable row level security;
alter table public.bank_accounts enable row level security;
alter table public.bank_transactions enable row level security;

-- No auth yet (see lib/company/context.ts). Only the service-role key
-- (server-only) may touch these tables until real auth + RLS policies land.
