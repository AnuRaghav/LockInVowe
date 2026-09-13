-- The Source Layer: a provider-neutral record of external financial reality.
--
-- This replaces the Plaid-first `bank_connections` / `bank_accounts` /
-- `bank_transactions` tables from 20260913025944_bank_connectors.sql. Nothing
-- read those tables (the Plaid sync route was their only writer), they only
-- ever held sandbox data, and keeping them alongside this schema would have
-- produced exactly the "Plaid model with Rho bolted on" shape we are avoiding.
-- They are dropped rather than migrated.
--
-- The layer answers one question - "what actually happened?" - and is built in
-- two tiers:
--
--   Tier 0  source_raw_records          Immutable provider payloads, append-only.
--   Tier 1  source_accounts             Provider-neutral projections of Tier 0.
--           source_balance_observations
--           source_entries
--
-- Tier 1 never destroys Tier 0, and every Tier 1 row points back at the raw
-- record it was projected from. Nothing here infers management intent, and
-- nothing here computes burn, runway, or any other derived figure: those belong
-- to the Numerical Model that will sit on top.

drop table if exists public.bank_transactions;
drop table if exists public.bank_accounts;
drop table if exists public.bank_connections;

create type public.source_provider as enum ('plaid', 'rho');
create type public.source_connection_status as enum ('active', 'error', 'revoked');
create type public.source_sync_status as enum ('running', 'succeeded', 'failed');
create type public.source_record_type as enum ('account', 'transaction');

-- What kind of thing the account is, in terms both providers share. Rho states
-- this directly (`account_type`); Plaid's `type`/`subtype` pair is mapped onto
-- it. The provider's own words are kept in `provider_attributes`.
create type public.source_account_kind as enum (
  'checking',
  'savings',
  'credit',
  'investment',
  'rewards',
  'other'
);

-- Where an entry sits in its provider's lifecycle, expressed neutrally.
--
--   pending    Money is moving but the amount or timing is not final.
--   posted     Final. The money moved.
--   failed     Attempted, and the money did not move.
--   scheduled  Recorded intent. No money has moved and it may never.
--
-- Plaid only ever produces `pending` and `posted`. Rho produces all four.
-- Which of these count toward cash is a Numerical Model decision, not one this
-- layer makes.
create type public.source_entry_status as enum (
  'pending',
  'posted',
  'failed',
  'scheduled'
);

-- One linked provider account-holder relationship: a Plaid Item, or a Rho API
-- token's business scope. Credentials are only ever read or written with the
-- service-role key from server code, and never reach the browser.
create table public.source_connections (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  provider public.source_provider not null,
  -- Plaid `item_id`; for Rho, a surrogate derived from the credential, because
  -- the v1 API exposes no business identifier. See lib/source/rho/adapter.ts.
  provider_connection_id text not null,
  display_name text,
  status public.source_connection_status not null default 'active',
  -- Provider-shaped secret bag: {access_token} for Plaid, {api_token, environment}
  -- for Rho. Deliberately opaque here - only the provider adapter reads it.
  credentials jsonb not null,
  -- Provider-shaped incremental-sync bookkeeping: {cursor} for Plaid's diff
  -- stream, {watermark} for Rho's time-windowed queries. Opaque to everything
  -- but the adapter that wrote it.
  sync_state jsonb not null default '{}'::jsonb,
  last_synced_at timestamptz,
  last_sync_error text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (company_id, provider, provider_connection_id),
  -- Redundant against the primary key, but required as the target of the
  -- composite foreign keys below, which is what stops a child row from ever
  -- being attributed to a different company than its parent.
  unique (id, company_id)
);

create index source_connections_company_id_idx
  on public.source_connections (company_id);

-- One attempt to pull from one connection. Every raw record and every Tier 1
-- row names the run that observed it, so freshness is always answerable.
create table public.source_sync_runs (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null,
  provider public.source_provider not null,
  status public.source_sync_status not null default 'running',
  started_at timestamptz not null default now(),
  finished_at timestamptz,
  sync_state_before jsonb,
  sync_state_after jsonb,
  counts jsonb not null default '{}'::jsonb,
  error text,
  foreign key (connection_id, company_id)
    references public.source_connections (id, company_id) on delete cascade,
  unique (id, company_id)
);

create index source_sync_runs_connection_idx
  on public.source_sync_runs (connection_id, started_at desc);

-- Tier 0. Exactly what the provider said, never edited.
--
-- The uniqueness key includes `payload_hash`, so re-observing an unchanged
-- record is a no-op while a *changed* record is stored as an additional row.
-- That makes this table the revision log: a Plaid transaction that moves from
-- pending to posted, or whose amount settles differently, leaves both payloads
-- behind. Retractions never delete from here.
create table public.source_raw_records (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null,
  sync_id uuid not null,
  provider public.source_provider not null,
  record_type public.source_record_type not null,
  provider_record_id text not null,
  payload jsonb not null,
  payload_hash text not null,
  observed_at timestamptz not null default now(),
  foreign key (connection_id, company_id)
    references public.source_connections (id, company_id) on delete cascade,
  foreign key (sync_id, company_id)
    references public.source_sync_runs (id, company_id) on delete cascade,
  unique (connection_id, record_type, provider_record_id, payload_hash)
);

create index source_raw_records_lookup_idx
  on public.source_raw_records (connection_id, record_type, provider_record_id, observed_at desc);

-- Tier 1: an account as this layer understands it.
create table public.source_accounts (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null,
  provider public.source_provider not null,
  provider_account_id text not null,
  kind public.source_account_kind not null,
  name text,
  mask text,
  currency text not null check (char_length(currency) = 3),
  -- The provider's own vocabulary, kept verbatim so nothing is lost by mapping
  -- onto `kind`: {type, subtype} for Plaid, {account_type} for Rho.
  provider_attributes jsonb not null default '{}'::jsonb,
  -- The most recent Tier 0 payload this projection was built from. Earlier
  -- versions stay in source_raw_records rather than being replaced.
  latest_raw_record_id uuid references public.source_raw_records (id) on delete set null,
  -- Set once by the column default and never written by an upsert, so it keeps
  -- meaning "when this layer first saw the account".
  first_seen_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  last_seen_sync_id uuid,
  foreign key (connection_id, company_id)
    references public.source_connections (id, company_id) on delete cascade,
  unique (connection_id, provider_account_id),
  unique (id, company_id)
);

create index source_accounts_company_id_idx
  on public.source_accounts (company_id, kind);

-- Tier 1: balances as append-only observations rather than a mutable column.
--
-- A balance is only ever true as of an instant, so it is stored as one. This is
-- what makes "cash on 1 August" answerable later, and it is why the previous
-- design's `bank_accounts.available_balance_usd` had to go: overwriting it each
-- sync destroyed the history any trend or reconciliation would need.
create table public.source_balance_observations (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  account_id uuid not null,
  sync_id uuid not null,
  observed_at timestamptz not null default now(),
  -- Signed position: positive = the company holds value, negative = it owes.
  -- Providers disagree on this (Plaid reports credit balances as a positive
  -- amount owed), so adapters normalize onto this convention.
  current_minor bigint not null,
  -- Spendable balance of funds actually held. Null where the provider has no
  -- such concept for the account: Plaid's `available` on a credit line is
  -- remaining headroom, which is a different thing, so it is left null here and
  -- kept in the raw record instead.
  available_minor bigint,
  currency text not null check (char_length(currency) = 3),
  raw_record_id uuid references public.source_raw_records (id) on delete set null,
  foreign key (account_id, company_id)
    references public.source_accounts (id, company_id) on delete cascade
);

create index source_balance_observations_account_idx
  on public.source_balance_observations (account_id, observed_at desc);

-- Tier 1: the normalized ledger.
--
-- The unit is an *entry* - one movement's effect on one account - not a
-- "transaction". That is Rho's native shape (it returns one row per account leg
-- and groups them with `money_movement_id`) and it is a faithful description of
-- what Plaid returns too, so it generalizes without distorting either.
create table public.source_entries (
  id uuid primary key default gen_random_uuid(),
  company_id uuid not null,
  connection_id uuid not null,
  account_id uuid not null,
  provider public.source_provider not null,
  provider_entry_id text not null,
  -- Groups the legs of one movement across accounts. Populated from Rho's
  -- `money_movement_id`; null for Plaid, which exposes no such link. Null means
  -- "this provider does not tell us", never "this entry stands alone".
  movement_key text,
  -- Signed minor units in `currency`. Positive = into this account,
  -- negative = out of it. Rho already reports this way; Plaid's opposite
  -- convention is inverted at the boundary.
  amount_minor bigint not null,
  currency text not null check (char_length(currency) = 3),
  status public.source_entry_status not null,
  initiated_at timestamptz,
  posted_at timestamptz,
  -- The single date to bucket this entry by: the posted date when there is one,
  -- otherwise the initiated date. Stored so downstream code does not have to
  -- re-derive the same coalesce, and so it is indexable.
  occurred_on date not null,
  description text not null,
  counterparty_name text,
  -- The provider's own classification, tagged with which taxonomy it speaks:
  -- {taxonomy: 'plaid.personal_finance_category', ...} or
  -- {taxonomy: 'rho.transaction_type', ...}. Never flattened into a shared
  -- string - the two vocabularies do not mean the same things.
  provider_category jsonb,
  provider_attributes jsonb not null default '{}'::jsonb,
  -- Plaid replaces a pending transaction with a new posted one under a fresh
  -- id; this points at the pending entry that was superseded, so the pair can
  -- be reconciled instead of double-counted. Null for Rho, which keeps one id
  -- across the whole lifecycle.
  supersedes_provider_entry_id text,
  -- Tombstone for a provider retraction (Plaid's `removed`). The row stays so
  -- an earlier calculation can still be explained; readers filter it out.
  withdrawn_at timestamptz,
  latest_raw_record_id uuid references public.source_raw_records (id) on delete set null,
  first_seen_at timestamptz not null default now(),
  last_observed_at timestamptz not null default now(),
  last_seen_sync_id uuid,
  foreign key (connection_id, company_id)
    references public.source_connections (id, company_id) on delete cascade,
  foreign key (account_id, company_id)
    references public.source_accounts (id, company_id) on delete cascade,
  unique (connection_id, provider_entry_id)
);

create index source_entries_company_date_idx
  on public.source_entries (company_id, occurred_on desc);
create index source_entries_account_date_idx
  on public.source_entries (account_id, occurred_on desc);
create index source_entries_movement_idx
  on public.source_entries (company_id, movement_key)
  where movement_key is not null;
create index source_entries_live_idx
  on public.source_entries (company_id, status, occurred_on desc)
  where withdrawn_at is null;

alter table public.source_connections enable row level security;
alter table public.source_sync_runs enable row level security;
alter table public.source_raw_records enable row level security;
alter table public.source_accounts enable row level security;
alter table public.source_balance_observations enable row level security;
alter table public.source_entries enable row level security;

-- No auth yet (see lib/company/context.ts), so no policies: RLS with zero
-- policies denies every anon and authenticated request. Only the service-role
-- key, used server-side, may touch these tables until real auth lands.
