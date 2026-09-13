/**
 * Rho REST client.
 *
 * Rho publishes an OpenAPI document but no JavaScript SDK, so this is a small
 * hand-written client over `fetch` covering the two resources the Source Layer
 * needs: accounts and transactions. The response types below are transcribed
 * from https://rhoapi-sandbox.rho.co/api/v1/openapi.json.
 *
 * Only this file and `map.ts` know Rho's wire format.
 */

export const RHO_ENVIRONMENTS = {
  sandbox: "https://rhoapi-sandbox.rho.co/api/v1",
  production: "https://rhoapi.rho.co/api/v1",
} as const;

export type RhoEnvironment = keyof typeof RHO_ENVIRONMENTS;

export const isRhoEnvironment = (value: unknown): value is RhoEnvironment =>
  typeof value === "string" && value in RHO_ENVIRONMENTS;

/** Minor units plus an ISO 4217 code - Rho reports money as integers already. */
export interface RhoMoney {
  amount: number;
  currency: string;
}

export type RhoAccountType =
  | "checking"
  | "credit"
  | "investment"
  | "savings"
  | "rewards";

export interface RhoAccount {
  id: string;
  account_type: RhoAccountType;
  account_name?: string | null;
  account_number_last_4?: string | null;
  routing_number_last_4?: string | null;
  balance: RhoMoney;
  available_balance?: RhoMoney | null;
}

export type RhoTransactionStatus =
  | "pending"
  | "settled"
  | "failed"
  | "awaiting_approval";

export interface RhoTransaction {
  id: string;
  money_movement_id: string;
  account_id: string;
  account_name: string;
  account_type: RhoAccountType;
  amount: RhoMoney;
  status: RhoTransactionStatus;
  transaction_type: string;
  counterparty_name: string;
  counterparty_logo_url?: string | null;
  initiated_at: string;
  posted_at?: string | null;
  memo?: string | null;
  note?: string | null;
  card_id?: string | null;
  card_name?: string | null;
  user_id?: string | null;
  user_full_name?: string | null;
  tracking_number?: string | null;
  attachments?: Array<{ file_id: string; file_name: string }>;
}

interface RhoPage {
  next_page_token: string | null;
}

export interface RhoListAccountsResponse {
  accounts: RhoAccount[];
  page: RhoPage;
}

export interface RhoListTransactionsResponse {
  transactions: RhoTransaction[];
  page: RhoPage;
}

export class RhoApiError extends Error {
  constructor(
    readonly status: number,
    readonly path: string,
    readonly detail: string
  ) {
    super(`Rho ${path} failed with ${status}: ${detail}`);
    this.name = "RhoApiError";
  }
}

export interface RhoClientOptions {
  apiToken: string;
  environment?: RhoEnvironment;
  /** Injectable for tests; defaults to the global fetch. */
  fetchImpl?: typeof fetch;
}

export interface RhoClient {
  listAccounts(params?: {
    pageSize?: number;
    pageToken?: string;
    signal?: AbortSignal;
  }): Promise<RhoListAccountsResponse>;
  listTransactions(params?: {
    pageSize?: number;
    pageToken?: string;
    initiatedAfter?: string;
    sortBy?: "initiated_at" | "posted_at" | "amount";
    order?: "asc" | "desc";
    signal?: AbortSignal;
  }): Promise<RhoListTransactionsResponse>;
}

export const createRhoClient = ({
  apiToken,
  environment = "sandbox",
  fetchImpl = fetch,
}: RhoClientOptions): RhoClient => {
  const baseUrl = RHO_ENVIRONMENTS[environment];

  const request = async <T>(
    path: string,
    query: Record<string, string | number | undefined>,
    signal?: AbortSignal
  ): Promise<T> => {
    const url = new URL(baseUrl + path);
    for (const [key, value] of Object.entries(query)) {
      if (value !== undefined) url.searchParams.set(key, String(value));
    }

    const response = await fetchImpl(url, {
      headers: {
        Authorization: `Bearer ${apiToken}`,
        Accept: "application/json",
      },
      signal,
    });

    if (!response.ok) {
      // Errors are RFC 9457 problem details; fall back to raw text when they
      // are not, so a gateway's HTML page still produces a usable message.
      const detail = await response.text().catch(() => "");
      throw new RhoApiError(response.status, path, detail.slice(0, 500));
    }

    return (await response.json()) as T;
  };

  return {
    listAccounts: ({ pageSize = 100, pageToken, signal } = {}) =>
      request<RhoListAccountsResponse>(
        "/accounts",
        { page_size: pageSize, page_token: pageToken },
        signal
      ),

    listTransactions: ({
      pageSize = 100,
      pageToken,
      initiatedAfter,
      sortBy = "initiated_at",
      order = "asc",
      signal,
    } = {}) =>
      request<RhoListTransactionsResponse>(
        "/transactions",
        {
          page_size: pageSize,
          page_token: pageToken,
          initiated_after: initiatedAfter,
          sort_by: sortBy,
          order,
        },
        signal
      ),
  };
};
