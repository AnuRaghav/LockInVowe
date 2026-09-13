import type { AccountBase, RemovedTransaction, Transaction } from "plaid";

import { resolveCompanyContext } from "@/lib/company/context";
import { getPlaidClient } from "@/lib/plaid/client";
import { createServiceClient } from "@/lib/supabase/service";

type SupabaseServiceClient = ReturnType<typeof createServiceClient>;

const upsertAccounts = async (
  supabase: SupabaseServiceClient,
  companyId: string,
  bankConnectionId: string,
  accounts: AccountBase[]
) => {
  if (accounts.length === 0) return new Map<string, string>();

  const { data, error } = await supabase
    .from("bank_accounts")
    .upsert(
      accounts.map((account) => ({
        company_id: companyId,
        bank_connection_id: bankConnectionId,
        provider_account_id: account.account_id,
        name: account.name,
        official_name: account.official_name ?? null,
        type: account.type ?? null,
        subtype: account.subtype ?? null,
        mask: account.mask ?? null,
        available_balance_usd: account.balances.available,
        current_balance_usd: account.balances.current,
        currency: account.balances.iso_currency_code ?? "USD",
        updated_at: new Date().toISOString(),
      })),
      { onConflict: "bank_connection_id,provider_account_id" }
    )
    .select("id, provider_account_id");

  if (error) throw error;

  return new Map(data.map((row) => [row.provider_account_id, row.id]));
};

const upsertTransactions = async (
  supabase: SupabaseServiceClient,
  companyId: string,
  accountIdByProviderId: Map<string, string>,
  transactions: Transaction[]
) => {
  const rows = transactions
    .map((txn) => {
      const bankAccountId = accountIdByProviderId.get(txn.account_id);
      if (!bankAccountId) return null;

      return {
        company_id: companyId,
        bank_account_id: bankAccountId,
        provider_transaction_id: txn.transaction_id,
        amount_usd: txn.amount,
        currency: txn.iso_currency_code ?? "USD",
        posted_date: txn.date,
        name: txn.name,
        merchant_name: txn.merchant_name ?? null,
        category: txn.personal_finance_category?.primary ?? txn.category?.[0] ?? null,
        pending: txn.pending,
        updated_at: new Date().toISOString(),
      };
    })
    .filter((row): row is NonNullable<typeof row> => row !== null);

  if (rows.length === 0) return;

  const { error } = await supabase
    .from("bank_transactions")
    .upsert(rows, { onConflict: "bank_account_id,provider_transaction_id" });

  if (error) throw error;
};

const removeTransactions = async (
  supabase: SupabaseServiceClient,
  removed: RemovedTransaction[]
) => {
  const ids = removed.map((txn) => txn.transaction_id).filter(Boolean);
  if (ids.length === 0) return;

  const { error } = await supabase
    .from("bank_transactions")
    .delete()
    .in("provider_transaction_id", ids);

  if (error) throw error;
};

/**
 * Pulls the latest accounts + transactions for one linked bank connection.
 * Uses Plaid's cursor-based `/transactions/sync` so repeat calls are cheap
 * incremental diffs rather than full refetches.
 */
export async function POST(req: Request) {
  const { companyId } = resolveCompanyContext(req);
  const body = await req.json().catch(() => null);
  const bankConnectionId = body?.bankConnectionId;

  if (typeof bankConnectionId !== "string" || !bankConnectionId) {
    return Response.json(
      { error: "bankConnectionId is required." },
      { status: 400 }
    );
  }

  const supabase = createServiceClient();

  const { data: connection, error: connectionError } = await supabase
    .from("bank_connections")
    .select("id, access_token, sync_cursor")
    .eq("id", bankConnectionId)
    .eq("company_id", companyId)
    .single();

  if (connectionError || !connection) {
    return Response.json(
      { error: "Bank connection not found." },
      { status: 404 }
    );
  }

  try {
    const plaid = getPlaidClient();
    let cursor: string | undefined = connection.sync_cursor ?? undefined;
    let hasMore = true;
    let added: Transaction[] = [];
    let modified: Transaction[] = [];
    let removed: RemovedTransaction[] = [];
    let accounts: AccountBase[] = [];

    while (hasMore) {
      const response = await plaid.transactionsSync({
        access_token: connection.access_token,
        cursor,
      });

      accounts = response.data.accounts;
      added = added.concat(response.data.added);
      modified = modified.concat(response.data.modified);
      removed = removed.concat(response.data.removed);
      hasMore = response.data.has_more;
      cursor = response.data.next_cursor;
    }

    const accountIdByProviderId = await upsertAccounts(
      supabase,
      companyId,
      bankConnectionId,
      accounts
    );
    await upsertTransactions(supabase, companyId, accountIdByProviderId, [
      ...added,
      ...modified,
    ]);
    await removeTransactions(supabase, removed);

    await supabase
      .from("bank_connections")
      .update({
        sync_cursor: cursor,
        last_synced_at: new Date().toISOString(),
        status: "active",
      })
      .eq("id", bankConnectionId);

    return Response.json({
      accountsSynced: accounts.length,
      transactionsAdded: added.length,
      transactionsModified: modified.length,
      transactionsRemoved: removed.length,
    });
  } catch (error) {
    console.error("Failed to sync Plaid data", error);
    await supabase
      .from("bank_connections")
      .update({ status: "error" })
      .eq("id", bankConnectionId);

    return Response.json({ error: "Failed to sync bank data." }, { status: 500 });
  }
}
