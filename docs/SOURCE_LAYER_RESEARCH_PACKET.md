# Source Layer Research Packet

Substrate description for designing a deterministic Numerical Model on top of an existing
financial Source Layer. This document is self-contained: it describes what financial
information the system can currently observe, what each field means, and what cannot be
established from it. It intentionally contains **no proposals** — no tables, no functions,
no architecture.

The product is an AI CFO agent ("Sam") for startup founders. The Source Layer is the only
thing that talks to external financial providers. Two providers are integrated today:
**Plaid** (aggregated bank/credit data via `/transactions/sync`) and **Rho** (a business
banking provider, REST API v1).

---

## 1. Shape of the layer

Two tiers, provider-neutral above the adapter boundary.

```
provider API ──▶ adapter (Plaid | Rho) ──▶ normalized observations ──▶ store
                                                                       ├─ Tier 0: raw payloads (append-only)
                                                                       └─ Tier 1: projections (idempotent upsert)
```

- **Tier 0** — `source_raw_records`: the provider payload captured verbatim, never edited,
  never deleted. Uniqueness includes a content hash, so a *changed* payload is stored
  alongside the one it changed from. This table is therefore a revision log.
- **Tier 1** — `source_accounts`, `source_balance_observations`, `source_entries`:
  provider-neutral projections. Every Tier 1 row points back at the Tier 0 record it was
  projected from (`latest_raw_record_id` / `raw_record_id`).
- Adapters expose exactly one method: `pull(context) → AsyncIterable<SourceSyncPage>`.
  There is no `added/modified/removed` triple in the neutral model — that is Plaid's diff
  shape. The neutral concept is an **observation**, upserted by natural key. Only
  *retraction* (which Plaid has and Rho genuinely does not) is a separate channel.
- Nothing in this layer computes cash, burn, runway, or any derived figure. It states what
  happened; interpretation is explicitly out of scope for it.

### Design rule the layer applies to itself

A concept is allowed into the neutral model only if (a) both providers genuinely mean the
same thing by it, and (b) it is a statement about *what happened*, not what it means.
"Posted amount" passes. "Category" fails — Plaid's personal-finance taxonomy and Rho's
`transaction_type` are different vocabularies, so both are carried as **tagged** provider
payloads rather than merged into a shared string.

---

## 2. Logical schema and types

TypeScript types below are the actual neutral vocabulary. SQL columns mirror them 1:1.

### 2.1 Enums

```ts
type SourceProviderId  = "plaid" | "rho";
type SourceRecordType  = "account" | "transaction";
type SourceAccountKind = "checking" | "savings" | "credit" | "investment" | "rewards" | "other";
type SourceEntryStatus = "pending" | "posted" | "failed" | "scheduled";
// SQL only:
// source_connection_status = 'active' | 'error' | 'revoked'
// source_sync_status       = 'running' | 'succeeded' | 'failed'
```

### 2.2 Connection

One linked provider relationship: a Plaid **Item**, or a Rho **API token's business scope**.

```sql
source_connections (
  id                      uuid pk,
  company_id              uuid not null,
  provider                source_provider,             -- 'plaid' | 'rho'
  provider_connection_id  text,                        -- Plaid item_id; Rho: sha256-derived surrogate
  display_name            text,
  status                  source_connection_status default 'active',
  credentials             jsonb,                       -- {access_token} | {api_token, environment}
  sync_state              jsonb default '{}',          -- {cursor} for Plaid | {watermark} for Rho
  last_synced_at          timestamptz,
  last_sync_error         text,
  created_at, updated_at  timestamptz,
  unique (company_id, provider, provider_connection_id)
)
```

`sync_state` is opaque outside the adapter that wrote it. Rho's v1 API exposes no business
identifier, so `provider_connection_id` for Rho is `rho_<sha256(api_token)[0:32]>` — a
stable surrogate that never reveals the token. **Consequence: rotating a Rho token yields a
new surrogate and therefore a new connection row unless a re-link flow updates in place.**

### 2.3 Sync run

```sql
source_sync_runs (
  id uuid pk, company_id uuid, connection_id uuid,
  provider           source_provider,
  status             source_sync_status,   -- running | succeeded | failed
  started_at         timestamptz,
  finished_at        timestamptz,
  sync_state_before  jsonb,
  sync_state_after   jsonb,
  counts             jsonb,   -- {rawRecords, accounts, balances, entries, retractions}
  error              text
)
```

Every raw record and every Tier 1 row names the run that observed it
(`sync_id` / `last_seen_sync_id`), so freshness is always answerable per row.
A failed run does **not** advance `sync_state`; a partially-completed run advances it only
through the last page actually persisted.

### 2.4 Account

```ts
interface NormalizedAccount {
  providerAccountId: string;
  kind: SourceAccountKind;
  name: string | null;          // Plaid official_name ?? name; Rho account_name
  mask: string | null;          // last 4 digits where exposed
  currency: string;             // ISO 4217, 3 letters
  providerAttributes: Record<string, unknown>;  // Plaid {type, subtype, name, officialName, unofficialCurrencyCode}
                                                // Rho   {accountType, routingNumberLast4}
  raw: RawObservation;
}
```

SQL adds: `first_seen_at` (set once), `last_observed_at`, `last_seen_sync_id`,
`latest_raw_record_id`, unique `(connection_id, provider_account_id)`.

### 2.5 Balance observation

Balances are **rows, not columns** — a balance is only ever true as of an instant.

```ts
interface NormalizedBalanceObservation {
  providerAccountId: string;
  observedAt: string;            // ISO; the sync's `now`, not a provider field
  currentMinor: number;          // signed position, minor units
  availableMinor: number | null; // spendable funds actually held, or null
  currency: string;
}
```

SQL: `source_balance_observations(company_id, account_id, sync_id, observed_at,
current_minor bigint, available_minor bigint, currency, raw_record_id)`. Append-only.

### 2.6 Entry (the ledger unit)

The unit is an **entry** — one movement's effect on **one** account — not a "transaction".
Rho natively returns one row per account leg and links them; Plaid returns one row per
account with no link. "Entry" describes both faithfully.

```ts
interface NormalizedEntry {
  providerEntryId: string;
  providerAccountId: string;
  movementKey: string | null;    // Rho money_movement_id; ALWAYS null for Plaid
  amountMinor: number;           // signed: + into this account, − out of it
  currency: string;
  status: SourceEntryStatus;
  initiatedAt: string | null;    // ISO
  postedAt: string | null;       // ISO; null unless status === 'posted'
  occurredOn: string;            // YYYY-MM-DD — posted date if any, else initiated date
  description: string;
  counterpartyName: string | null;
  providerCategory: ProviderCategory | null;
  providerAttributes: Record<string, unknown>;
  supersedesProviderEntryId: string | null;  // Plaid pending→posted link; null for Rho
  raw: RawObservation;
}

interface ProviderCategory {
  taxonomy: string;   // 'plaid.personal_finance_category' | 'plaid.category' | 'rho.transaction_type'
  value: string;
  detail?: string;
  confidence?: string;
}
```

SQL adds: `withdrawn_at timestamptz` (retraction tombstone), `first_seen_at`,
`last_observed_at`, `last_seen_sync_id`, `latest_raw_record_id`,
unique `(connection_id, provider_entry_id)`.

Indexes that exist: `(company_id, occurred_on desc)`, `(account_id, occurred_on desc)`,
`(company_id, movement_key) where movement_key is not null`,
`(company_id, status, occurred_on desc) where withdrawn_at is null`.

### 2.7 Raw record and retraction

```ts
interface RawObservation {
  recordType: "account" | "transaction";
  providerRecordId: string;   // as the provider spells it
  payload: unknown;           // verbatim, never trimmed
  observedAt: string;         // when this layer received it
}

interface NormalizedRetraction { providerEntryId: string; observedAt: string; }
```

```sql
source_raw_records (
  id, company_id, connection_id, sync_id, provider,
  record_type, provider_record_id, payload jsonb, payload_hash text, observed_at,
  unique (connection_id, record_type, provider_record_id, payload_hash)
)
```

`payload_hash` is sha256 over a **key-sorted** JSON serialization, so reordered-but-identical
payloads do not create spurious revisions.

### 2.8 Sync page (adapter output)

```ts
interface SourceSyncPage {
  accounts?:    NormalizedAccount[];
  balances?:    NormalizedBalanceObservation[];
  entries?:     NormalizedEntry[];
  retractions?: NormalizedRetraction[];
  syncStateAfter: Record<string, unknown>;   // opaque; {cursor} or {watermark}
}
```

---

## 3. Semantics

### Money units
Every amount is an **integer count of minor units** plus an ISO 4217 code. Never a float,
never a bare number. Cents are exact in IEEE 754 to 2^53, so summing is exact. Minor-unit
exponent is 2 by default with an explicit exception table (JPY/KRW/CLP/ISK/PYG/UGX/VND = 0;
BHD/IQD/JOD/KWD/LYD/OMR/TND = 3). Rho reports minor units natively; Plaid reports decimals
and is converted at the adapter boundary via `Math.round(value * 10^exp)`, which throws on
non-finite values or unsafe-integer overflow rather than persisting a 0.

### Sign convention (entries)
**Positive = money into this account. Negative = money out of it.** Rho already reports this
way and passes through unchanged. Plaid reports the *opposite* (positive = money leaving),
so Plaid amounts are negated in the mapper. This inversion is invisible above the adapter.

### Sign convention (balances)
`currentMinor` is a **signed position**: positive = the company holds value, negative = it
owes. Plaid reports a credit line's `current` as a **positive amount owed**, so the Plaid
mapper negates balances for `kind === 'credit'`. Rho's ledger is signed throughout and is
passed through unchanged.

> **Caveat carried in the code:** the Rho credit-balance sign is an *inference* from Rho's
> transaction sign convention, not something Rho's docs state. Every credit account in the
> Rho sandbox sits at zero, so the assumption has never been exercised against real data.
> It is pinned by a test to keep it visible.

### `availableMinor` semantics
"Spendable balance of funds **actually held**." Null where the provider has no such concept:
- Plaid credit lines: Plaid's `available` there is *remaining headroom on the line*, a
  different quantity, so it is deliberately **not** projected — it stays in the raw payload.
- Rho: `available_balance` is marked internal in Rho's OpenAPI doc and absent from sandbox
  responses, so it is read when present and left null otherwise. In practice, **Rho balance
  observations currently carry `availableMinor = null`.**

### Currency semantics
Per-row `currency` on accounts, balances and entries. Providers' `null`/lowercase/missing
codes are coerced; unrecognized codes fall back to `USD` rather than throwing (dropping a
real transaction is judged the worse failure). Plaid's `unofficial_currency_code` is kept in
`providerAttributes` so a null ISO code can be distinguished from an omission.
**No FX conversion exists anywhere in the layer.** Amounts in different currencies are
never converted or combined.

### Account kinds
Rho's `account_type` maps 1:1 onto the shared vocabulary (checking/savings/credit/
investment/rewards). Plaid's `type`/`subtype` pair is collapsed: `depository` splits into
`checking` vs `savings` (savings / cd / money market → savings); `credit` → credit;
`investment` | `brokerage` → investment; everything else (including loans) → `other`.
The mapping is lossy on purpose and the provider's own words survive in
`providerAttributes`.

### Entry lifecycle
| status | meaning | Plaid | Rho |
|---|---|---|---|
| `pending` | money is moving; amount or timing not final | `pending: true` | `pending` |
| `posted` | final; the money moved | `pending: false` | `settled` |
| `failed` | attempted; the money did **not** move | never emitted | `failed` |
| `scheduled` | recorded intent; no money has moved and it may never | never emitted | `awaiting_approval` |

Which of these count toward a cash figure is **deliberately not decided** by this layer.
Note the asymmetry: Rho reports failed movements and unapproved intents in the same feed as
real ones; Plaid simply has no such records.

### Withdrawn / retracted records
Plaid's `removed` channel sets `withdrawn_at` on the existing entry — a **tombstone, never a
delete**, so a figure produced before the retraction can still be explained afterwards.
Readers must filter `withdrawn_at is null`. **Rho never retracts**: absence of a transaction
from a page means it fell outside the query window, not that it was withdrawn, and the
adapter deliberately emits an empty retraction channel rather than simulating one.

### Timestamps
- `initiatedAt` — Plaid `authorized_datetime`, else midnight UTC of `authorized_date`;
  Rho `initiated_at`.
- `postedAt` — populated **only** when `status === 'posted'`. Rho populates `posted_at` even
  on rows that never posted (observed on `failed` rows in the sandbox), so **status, not the
  presence of the timestamp, is the authority.**
- `occurredOn` — `YYYY-MM-DD`, UTC date slice: posted date when there is one, else initiated
  date, else the observation date. This is the single bucketing date.
- `observedAt` on raw records / balances is the **sync's** `now`, injected rather than read
  from the clock. It is *not* a provider field and says only when this layer saw the value.
- `first_seen_at` / `last_observed_at` on Tier 1 rows bracket the observation window for that
  record.

### Movement IDs / transfer linkage
`movementKey` is populated **only** from Rho's `money_movement_id` and groups the legs of one
movement across accounts (e.g. a card repayment is `-1750` on checking and `+1750` on credit
under one key; the pair sums to zero). For Plaid it is **always null**, and null means
*"this provider does not tell us"*, never *"this entry stands alone."*

### Plaid pending→posted supersession
Plaid retires a pending transaction and issues the posted one under a **new** transaction id.
`supersedesProviderEntryId` carries `pending_transaction_id` so the pair can be reconciled
instead of double-counted. Rho keeps one id across the whole lifecycle, so this is always
null for Rho — a Rho entry mutates in place (its Tier 1 row is updated; Tier 0 keeps both
payload revisions).

### Provider differences that survive normalization
| | Plaid | Rho |
|---|---|---|
| Incremental sync | diff cursor (`/transactions/sync`) | time watermark over `initiated_at` |
| Retractions | yes (`removed`) | none |
| Cross-account movement link | none | `money_movement_id` |
| Pending→posted | new id + supersedes link | same id, status changes |
| Statuses emitted | pending, posted | pending, posted, failed, scheduled |
| Amount sign | positive = money out (inverted at boundary) | already signed |
| Amount format | decimal | minor units |
| Credit balance | positive amount owed (negated at boundary) | already signed (assumed) |
| `available` | headroom on credit lines (dropped there) | internal field, usually absent |
| Linking flow | Link handshake → public-token exchange | pasted long-lived API token |

### Freshness
Four independent signals:
1. `source_connections.last_synced_at`, `.status`, `.last_sync_error`.
2. `source_sync_runs` — full history of attempts with status, timings, and counts.
3. Per-row `last_observed_at` + `last_seen_sync_id` on accounts and entries.
4. `observed_at` on each balance observation and raw record.

**Important interaction:** balance observations are deduplicated *by value* — a balance
identical to the account's most recent reading appends no row. So the newest balance row's
`observed_at` is *"when this value first appeared"*, **not** *"when we last checked."*
Last-checked must come from the connection or the sync run.

### Provenance / traceability
Every Tier 1 row carries `latest_raw_record_id` (or `raw_record_id` for balances) pointing at
the exact Tier 0 payload it was projected from, and `last_seen_sync_id` naming the run.
Earlier payload revisions are retained in `source_raw_records` keyed by `payload_hash`, so
the full observation history of any provider record is recoverable and Tier 1 can be
re-derived from Tier 0 without re-contacting the provider.

---

## 4. What the data lets us observe today

**Supported by the code and data as written:**

- **Current balance per account**, as a signed position in minor units, for every account the
  connection reports (checking, savings, credit, investment, rewards).
- **Historical balances** — but only from the first sync onward, and only at instants where
  the value *changed*. No provider balance backfill exists.
- **Available (spendable) balance** for Plaid depository accounts. Null for Plaid credit and
  currently null for all Rho accounts.
- **Cash entering and leaving each account**, as signed entries with a bucketing date, a
  description, and a lifecycle status.
- **Transfers between known accounts, for Rho only**, via `movementKey` — both legs are
  identifiable as one movement and sum to zero.
- **Credit-card / credit-line activity** — credit accounts are first-class (`kind='credit'`),
  their entries are captured, and their balances are stated as negative positions.
- **Pending movements** — `status='pending'`, from both providers.
- **Failed and scheduled (awaiting-approval) movements** — Rho only. These are *recorded and
  labelled*, never silently folded into cash.
- **Counterparty names as the provider states them** — Plaid `merchant_name`, Rho
  `counterparty_name`.
- **Provider categories, tagged by taxonomy** — `plaid.personal_finance_category` (with
  detail + confidence), `plaid.category` (legacy fallback), `rho.transaction_type`.
- **Historical changes to provider records** — the Tier 0 revision log captures every changed
  payload for a given provider record id, with observation timestamps.
- **Card and initiator attribution for Rho** — `cardId`, `cardName`, `userId`, `userFullName`
  are carried in `providerAttributes` (not normalized fields).
- **Payment channel / transaction code for Plaid** — in `providerAttributes`.
- **Sync health and freshness** — per connection and per run.

---

## 5. Representative normalized examples

Fixtures below are real payloads captured from the Rho sandbox
(`https://rhoapi-sandbox.rho.co`) and from Plaid sandbox-shaped data, expressed in the
normalized form. `observedAt` is `2026-09-13T12:00:00.000Z` throughout.

### 5.1 Operating outflow (Plaid, posted)

Plaid sent `amount: 89.40` (positive = money out). Normalized:

```json
{
  "providerEntryId": "txn_posted",
  "providerAccountId": "acc_checking",
  "movementKey": null,
  "amountMinor": -8940,
  "currency": "USD",
  "status": "posted",
  "initiatedAt": "2026-09-09T00:00:00.000Z",
  "postedAt": "2026-09-10T00:00:00.000Z",
  "occurredOn": "2026-09-10",
  "description": "AWS EMEA",
  "counterpartyName": "Amazon Web Services",
  "providerCategory": {
    "taxonomy": "plaid.personal_finance_category",
    "value": "GENERAL_SERVICES",
    "detail": "GENERAL_SERVICES_OTHER_GENERAL_SERVICES",
    "confidence": "HIGH"
  },
  "providerAttributes": { "paymentChannel": "online", "transactionCode": null,
                          "authorizedDate": "2026-09-09", "unofficialCurrencyCode": null },
  "supersedesProviderEntryId": null
}
```

### 5.2 Internal transfer (Rho) — both legs of one movement

A daily credit repayment: `-1750` out of checking, `+1750` into the credit account, linked
by `movementKey`. The two amounts sum to zero.

```json
[
  {
    "providerEntryId": "019f0143-3ea0-7000-8000-000000000002",
    "providerAccountId": "30000000-0000-4000-8000-000000000002",
    "movementKey": "40000000-0000-4000-8000-000000000002",
    "amountMinor": -1750, "currency": "USD", "status": "posted",
    "initiatedAt": "2026-06-26T00:10:12Z", "postedAt": "2026-06-26T00:10:12Z",
    "occurredOn": "2026-06-26",
    "description": "Daily credit repayment for date 2026/06/24",
    "counterpartyName": "Credit Account",
    "providerCategory": { "taxonomy": "rho.transaction_type", "value": "credit_repayment" },
    "supersedesProviderEntryId": null
  },
  {
    "providerEntryId": "019f0143-3ea0-7000-8000-000000000003",
    "providerAccountId": "30000000-0000-4000-8000-000000000007",
    "movementKey": "40000000-0000-4000-8000-000000000002",
    "amountMinor": 1750, "currency": "USD", "status": "posted",
    "occurredOn": "2026-06-26",
    "description": "Daily credit repayment for date 2026/06/24",
    "counterpartyName": "Cash (Checking)",
    "providerCategory": { "taxonomy": "rho.transaction_type", "value": "credit_repayment" }
  }
]
```

The second leg lands on a `kind: "credit"` account — this is also the credit-related example.

### 5.3 Failed movement (Rho)

An attempted rent check that did not clear. Rho sent a `posted_at`; the mapper suppresses it
because status is the authority.

```json
{
  "providerEntryId": "019eda73-2218-7000-8000-000000000012",
  "providerAccountId": "30000000-0000-4000-8000-000000000002",
  "movementKey": "40000000-0000-4000-8000-000000000015",
  "amountMinor": -339100,
  "currency": "USD",
  "status": "failed",
  "initiatedAt": "2026-06-18T11:17:19Z",
  "postedAt": null,
  "occurredOn": "2026-06-18",
  "description": "Monthly office rent",
  "counterpartyName": "Crescent Property Group",
  "providerCategory": { "taxonomy": "rho.transaction_type", "value": "check_payment" },
  "providerAttributes": { "rhoStatus": "failed", "note": "Monthly office rent", "...": "..." }
}
```

### 5.4 Scheduled / unapproved movement (Rho)

$12,500 of recorded intent. No money has moved and it may never.

```json
{
  "providerEntryId": "019d3e86-4482-7000-8000-000000000048",
  "providerAccountId": "30000000-0000-4000-8000-000000000002",
  "movementKey": "40000000-0000-4000-8000-000000000065",
  "amountMinor": -1250000,
  "currency": "USD",
  "status": "scheduled",
  "initiatedAt": "2026-03-30T11:36:00Z",
  "postedAt": null,
  "occurredOn": "2026-03-30",
  "description": "Q3 freight invoice",
  "counterpartyName": "Harborline Logistics",
  "providerCategory": { "taxonomy": "rho.transaction_type", "value": "ach_debit" },
  "providerAttributes": { "rhoStatus": "awaiting_approval", "...": "..." }
}
```

### 5.5 Pending entry (Plaid)

```json
{
  "providerEntryId": "txn_pending",
  "providerAccountId": "acc_checking",
  "movementKey": null,
  "amountMinor": -8940,
  "status": "pending",
  "initiatedAt": "2026-09-09T00:00:00.000Z",
  "postedAt": null,
  "occurredOn": "2026-09-09",
  "supersedesProviderEntryId": null
}
```

…and the posted entry that later replaces it arrives under a **new id** carrying
`"supersedesProviderEntryId": "txn_pending"`.

### 5.6 Balance observations

```json
[
  { "providerAccountId": "acc_checking", "observedAt": "2026-09-13T12:00:00.000Z",
    "currentMinor": 11025, "availableMinor": 10050, "currency": "USD" },

  { "providerAccountId": "acc_credit",  "observedAt": "2026-09-13T12:00:00.000Z",
    "currentMinor": -30000, "availableMinor": null, "currency": "USD" },

  { "providerAccountId": "30000000-0000-4000-8000-000000000002",
    "observedAt": "2026-09-13T12:00:00.000Z",
    "currentMinor": 876138, "availableMinor": null, "currency": "USD" }
]
```

Row 2 is Plaid's `$300 owed` credit card: stated as `-30000` (a negative position), with
Plaid's `$4,700 available headroom` deliberately **not** projected. Row 3 is the Rho sandbox
checking account at `$8,761.38`, with no available balance reported.

### 5.7 An operating **inflow**

No inflow fixture exists in the captured sandbox/test data. Structurally an inflow is simply
an entry with `amountMinor > 0` on a non-credit account (Plaid: a negative `amount` inverted;
Rho: a positive signed amount). No inflow-specific field, flag, or classification exists.

---

## 6. Limitations

### (1) Derivable from current source data (no new provider needed)

These are *not implemented* — nothing above the Source Layer reads these tables today — but
the substrate supports them deterministically:

- Balance-at-an-instant per account and summed positions by `kind`, from the balance
  observation series (subject to the value-dedupe caveat and to sync coverage).
- Net movement over a date range per account, by summing `amountMinor` filtered on
  `status`, `withdrawn_at is null`, and `occurred_on`.
- Separation of asset accounts from credit accounts via `kind`.
- Excluding failed and scheduled entries from cash figures.
- Excluding Plaid's superseded pending entries via `supersedesProviderEntryId`.
- Identifying Rho internal transfers via `movementKey` (both legs, zero-sum).
- Freshness / staleness of any figure, via sync runs and per-row observation timestamps.
- Full audit trail from any number back to the provider payload that produced it.
- Counterparty **string** frequency and per-counterparty totals (as literal provider strings).
- Provider-category rollups, **within one provider's taxonomy at a time**.

### (2) Approximable, but with real uncertainty

- **Whether two Plaid entries are one internal transfer.** Plaid exposes no movement link at
  all. Any pairing is an amount/date/description heuristic and can be wrong in both
  directions (false pairs; missed pairs across institutions or with fees/timing skew).
- **Merchant / vendor identity.** `counterpartyName` is whatever the provider wrote. There is
  no normalization, no canonical merchant id, no cross-provider entity resolution, and no
  dedupe of spelling variants. Rho descriptions frequently fall back to the counterparty
  string when there is no memo.
- **Recurring vs one-off spend, and subscription detection.** Nothing in the layer marks
  recurrence; it would be a pattern inference over descriptions and dates.
- **Expense categorization across providers.** The two taxonomies are deliberately kept
  distinguishable and are not merged. Any unified category scheme is a new inference layer,
  and Plaid's `personal_finance_category` is a *personal*-finance taxonomy applied to a
  business, carrying its own confidence field.
- **Cash-in as "revenue".** Deposits are observable; whether a given inflow is revenue,
  a refund, a loan draw, an investor wire, or an internal transfer from an unlinked account
  is not stated anywhere.
- **Burn rate.** Derivable as net cash movement, but only for *linked* accounts, only over
  the synced window, and only if transfers are correctly excluded — which Plaid cannot
  support (see above).
- **Rho credit-balance sign in production.** Inferred, never exercised against a non-zero
  real credit balance.
- **Duplicate coverage.** Uniqueness is `(connection_id, provider_entry_id)`. If the same
  underlying bank account is linked through both Plaid and Rho (or two Plaid Items), the same
  economic event exists as two independent entries with no linkage and no dedupe. Nothing in
  the layer detects this.

### (3) Fundamentally requires another data source

- **Accounting revenue** (recognized vs cash received), deferred revenue, accruals — needs an
  accounting system (QuickBooks/Xero) or a billing system.
- **COGS, gross margin, expense-vs-capitalization treatment** — needs a chart of accounts.
- **MRR / ARR, churn, expansion, customer counts** — needs a billing/subscription system
  (Stripe et al.) or CRM.
- **Accounts receivable, invoices, collections, DSO** — needs an AR/invoicing source.
- **Accounts payable / future obligations** beyond Rho's unapproved-payment queue — needs
  AP or contract data. Rho's `scheduled` status covers *awaiting approval only*, not a
  general schedule of future payments.
- **Payroll commitments, headcount, salaries, benefits, contractor spend as commitments** —
  payroll shows up only as historical outflows with a counterparty string; there is no
  employee roster, no per-head cost, no start/end dates. Needs a payroll provider.
- **FX rates and multi-currency consolidation** — no rate source and no conversion exists.
- **Vendor contracts, committed spend, renewal dates, cancellation terms.**
- **Cap table, debt terms, covenants, credit-line limits as a modelled constraint** (Plaid's
  `limit` is present in raw payloads but is not projected into Tier 1).
- **Tax liabilities, accrued but unpaid obligations.**
- **Company plans, targets, hiring intentions, minimum-runway policy** — these live in a
  separate memory layer (see §7), not in the Source Layer.

### (4) Operational / coverage limitations

- **Sync is manual.** It is triggered only by `POST /api/source/sync` with a `connectionId`.
  There is no scheduler, no cron, no webhook consumer. Data is exactly as fresh as the last
  manual call.
- **Rho initial lookback is 180 days**, and incremental sync is a watermark over
  `initiated_at` rewound by **14 days** each run. Consequence: a Rho entry whose *status*
  changes more than 14 days after its `initiated_at` will not be re-read and may stay
  `pending` (or `scheduled`) forever.
- **Rho has no diff endpoint, no removal channel, and no webhook** in the v1 surface used.
- **Plaid history depth** is whatever `/transactions/sync` returns from a null cursor for
  that Item; it is not bounded or configured by this layer.
- **No balance history before the first sync.** Balance observations begin at first link.
- **Balance observations are value-deduplicated**, so the series records changes, not checks.
- **Plaid balances are emitted once per sync** (first page only), so at most one balance
  observation per account per sync run.
- **No authentication yet.** `company_id` comes from a fixed development constant
  (`DEV_COMPANY_ID`) with a dev-only override header. RLS is enabled on all `source_*` tables
  with **zero policies**, so only the service-role key can read or write them.
- **Only Plaid and Rho exist.** No Stripe, no accounting, no payroll adapter.
- **Investment and rewards accounts** are representable but untested; their balance semantics
  (market value vs cost basis vs settled cash) are not established.
- **An entry referencing an account the connection never reported throws** rather than being
  silently dropped — so ingestion fails loudly on provider inconsistency.

---

## 7. What already exists above the Source Layer

Very little, and **nothing that reads the `source_*` tables**. The Source Layer is currently
write-only from the application's perspective: the only writers are
`POST /api/plaid/exchange-public-token`, `POST /api/source/connections` (Rho), and
`POST /api/source/sync`.

### `lib/finance/`

One module: **`runway.ts`**.

```ts
interface RunwayInput {
  cashOnHandUsd: number;      // float USD, supplied by caller
  monthlyRevenueUsd: number;
  monthlyExpensesUsd: number;
  asOf?: Date;
}

interface RunwayResult {
  netMonthlyBurnUsd: number;                 // expenses − revenue
  runwayMonths: number | null;               // null when not burning
  zeroCashDate: string | null;               // YYYY-MM-DD, null when not burning
  status: "cash_flow_positive" | "healthy" | "warning" | "critical";
}
```

Thresholds: `< 3` months → critical, `< 6` → warning, else healthy. Throws on negative or
non-finite inputs. Note it takes **USD floats**, not minor units, and has no currency
concept — it does not share the Source Layer's money discipline. That is the whole of the
finance layer.

### Sam's tools

Three, registered in `lib/agents/sam/tools/index.ts`:

1. **`calculate_runway`** — thin adapter over `calculateRunway()`. Its three numeric inputs
   are supplied **by the model** (i.e. ultimately by the founder in conversation). It is not
   database-backed; `companyId` comes from trusted server context, not the model.
2. **`search_memory`** — queries a company-knowledge store by text/kind/labels.
3. **`get_memory`** — fetches a memory record by id.

### `lib/memory/`

An interface-only memory abstraction (`MemoryRecord` with `kind`, free-text `content`,
`labels`, `importance`, `source`, `recordedAt`, open `attributes`). Known kinds: fact,
assumption, goal, constraint, plan, commitment, decision, relationship, document. The **only
implementation is in-memory and seeded with three hard-coded development records** (a
12-month runway floor, a March Series A plan, a senior-engineer hire under consideration).
Nothing is persisted.

**Net: the gap is total.** No code path connects observed provider data to any financial
figure. Runway today is computed from numbers a founder tells the model.

---

## 8. Contract

### Safe invariants

A deterministic Numerical Model can rely on all of the following:

1. Every monetary amount is an **exact integer** count of minor units, paired with a
   3-letter ISO 4217 code on the same row. No floats, no rounding drift on summation.
2. **Entry sign is universal**: positive = into the account, negative = out of it, for every
   provider, on every account kind.
3. **Balance sign is a position**: positive = value held, negative = value owed, for every
   provider and account kind (with the Rho-credit caveat flagged in §3).
4. `availableMinor` never means credit headroom. When non-null it means spendable funds
   actually held. It is frequently null.
5. Every entry has exactly one `occurredOn` (`YYYY-MM-DD`, UTC) and belongs to exactly one
   account. There is no multi-account entry.
6. `postedAt` is non-null **only** when `status === 'posted'`. Status is always authoritative
   over timestamp presence.
7. `status` partitions entries cleanly into four disjoint states, and `failed` / `scheduled`
   represent money that has **not** moved.
8. `withdrawn_at is null` is a complete filter for live records; retracted records are never
   deleted, only tombstoned.
9. Tier 1 is **idempotent** — re-syncing the same window produces no duplicate accounts,
   entries, or balance rows. Tier 0 is **append-only** and preserves every distinct payload
   revision.
10. Every Tier 1 row is traceable to the exact provider payload and sync run that produced it.
11. A non-null `movementKey` groups legs of one real movement, and those legs sum to zero
    within a currency.
12. A failed sync never advances `sync_state`; the next run resumes from the last state
    actually persisted.
13. `providerCategory.taxonomy` always identifies which vocabulary `value` speaks; category
    values from different taxonomies are never comparable.
14. Balance observations are strictly append-only and each is true as of its `observed_at`.
15. Every row is scoped by `company_id`, enforced by composite foreign keys that make it
    impossible for a child row to be attributed to a different company than its connection.

### Unresolved / unavailable information — must not be silently assumed

1. **`movementKey = null` does not mean "not a transfer."** It means the provider (Plaid)
   does not say. Plaid internal transfers are indistinguishable from external flows without
   inference.
2. **A positive entry is not revenue.** Nothing distinguishes revenue from refunds, transfers
   from unlinked accounts, loan draws, or investor funding.
3. **A negative entry is not an expense in any accounting sense** — no COGS/opex split, no
   capitalization, no accrual timing.
4. **Linked accounts are not all accounts.** Total observed cash is a floor, not the company's
   cash position. There is no register of which accounts exist.
5. **The latest balance observation is not "today's balance."** It is the last *changed* value
   seen at the last *manual* sync. Freshness must be read from the connection/sync run.
6. **Pending amounts are not final.** Plaid pending entries are replaced by a differently-idd
   posted entry, potentially at a different amount.
7. **`scheduled` is not a payment schedule.** It is Rho's awaiting-approval queue only, and it
   may never execute. There is no forward calendar of obligations.
8. **`failed` entries must never enter a cash figure** — and they carry a `posted_at` from Rho
   that must be ignored.
9. **Counterparty strings are not entities.** No normalization, no ids, no cross-provider
   resolution.
10. **Categories are not a shared taxonomy** and Plaid's is a personal-finance taxonomy with
    a confidence level, applied to a business.
11. **No currency conversion exists.** Multi-currency amounts must not be summed.
12. **No MRR/ARR, no revenue recognition, no AR/AP, no payroll roster, no contracts, no cap
    table, no credit limits, no tax liabilities** are present in any form.
13. **Rho status transitions older than 14 days may be permanently stale**, and Rho history
    starts at 180 days before first link.
14. **The same economic event may appear twice** if an account is linked through two
    connections; nothing detects or resolves this.
15. **The Rho credit-balance sign is an unverified inference.**
16. **Investment / rewards balance semantics are undefined.**
17. **Company intent — targets, hiring plans, runway policy, fundraising timing — is not in
    this layer at all**, and the only place it currently lives is three seeded in-memory
    development records.
