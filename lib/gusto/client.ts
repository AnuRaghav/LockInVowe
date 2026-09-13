/**
 * Minimal Gusto REST client. Gusto has no official Node SDK, so this wraps
 * plain `fetch` against their OAuth2 + REST API. Sandbox by default - set
 * GUSTO_ENV=production to move off the demo API once real companies are
 * needed.
 */

const getGustoEnv = () => process.env.GUSTO_ENV ?? "sandbox";

/**
 * Gusto versions its whole API by date (see
 * https://docs.gusto.com/embedded-payroll/docs/api-versioning); every REST
 * call (not the OAuth endpoints) must send this or Gusto falls back to the
 * app's configured minimum version, which can silently change behavior.
 */
const GUSTO_API_VERSION = process.env.GUSTO_API_VERSION ?? "2026-06-15";

/** Base URL for OAuth + REST calls. Sandbox uses a separate host, not a path prefix. */
export const getGustoApiBase = (): string =>
  getGustoEnv() === "production"
    ? "https://api.gusto.com"
    : "https://api.gusto-demo.com";

const getGustoOAuthConfig = () => {
  const clientId = process.env.GUSTO_CLIENT_ID;
  const clientSecret = process.env.GUSTO_CLIENT_SECRET;
  const redirectUri = process.env.GUSTO_REDIRECT_URI;

  if (!clientId || !clientSecret || !redirectUri) {
    throw new Error(
      "Missing Gusto credentials. Set GUSTO_CLIENT_ID, GUSTO_CLIENT_SECRET, and GUSTO_REDIRECT_URI in .env.local."
    );
  }

  return { clientId, clientSecret, redirectUri };
};

/**
 * Pages allowed to receive the founder back after Gusto's OAuth redirect.
 * An allowlist rather than any relative path, so `returnTo` can't be turned
 * into an open redirect by editing the authorize link.
 */
const GUSTO_RETURN_PATHS = ["/connect", "/onboarding"] as const;
export type GustoReturnPath = (typeof GUSTO_RETURN_PATHS)[number];

export const toGustoReturnPath = (value: unknown): GustoReturnPath =>
  GUSTO_RETURN_PATHS.includes(value as GustoReturnPath) ? (value as GustoReturnPath) : "/connect";

/**
 * TEMPORARY: `state` is the company id plus where to return, unsigned. Fine
 * while there is one dev company and no session to forge (see
 * lib/company/context.ts); replace with a signed, single-use token once auth
 * exists.
 */
export const encodeGustoOAuthState = (companyId: string, returnTo: GustoReturnPath): string =>
  `${companyId}|${returnTo}`;

export const decodeGustoOAuthState = (
  state: string | null
): { companyId: string; returnTo: GustoReturnPath } | null => {
  if (!state) return null;
  const [companyId, returnTo] = state.split("|");
  if (!companyId) return null;
  return { companyId, returnTo: toGustoReturnPath(returnTo) };
};

/** Builds the URL to send a founder to in order to authorize LockInVowe against their Gusto account. */
export const buildGustoAuthorizeUrl = (state: string): string => {
  const { clientId, redirectUri } = getGustoOAuthConfig();
  const url = new URL(`${getGustoApiBase()}/oauth/authorize`);
  url.searchParams.set("client_id", clientId);
  url.searchParams.set("redirect_uri", redirectUri);
  url.searchParams.set("response_type", "code");
  url.searchParams.set("state", state);
  return url.toString();
};

export interface GustoTokenResponse {
  access_token: string;
  refresh_token: string;
  expires_in: number;
  token_type: string;
}

const requestToken = async (
  params: Record<string, string>
): Promise<GustoTokenResponse> => {
  const { clientId, clientSecret, redirectUri } = getGustoOAuthConfig();

  const response = await fetch(`${getGustoApiBase()}/oauth/token`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      client_secret: clientSecret,
      redirect_uri: redirectUri,
      ...params,
    }),
  });

  if (!response.ok) {
    throw new Error(`Gusto token request failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
};

export const exchangeGustoCode = (code: string): Promise<GustoTokenResponse> =>
  requestToken({ grant_type: "authorization_code", code });

export const refreshGustoToken = (refreshToken: string): Promise<GustoTokenResponse> =>
  requestToken({ grant_type: "refresh_token", refresh_token: refreshToken });

/** Authenticated GET against the Gusto REST API. */
export const gustoGet = async <T>(accessToken: string, path: string): Promise<T> => {
  const response = await fetch(`${getGustoApiBase()}${path}`, {
    headers: {
      Authorization: `Bearer ${accessToken}`,
      Accept: "application/json",
      "X-Gusto-API-Version": GUSTO_API_VERSION,
    },
  });

  if (!response.ok) {
    throw new Error(`Gusto API request to ${path} failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
};

interface GustoTokenInfo {
  resource?: { type?: string; uuid?: string } | null;
}

/**
 * The Gusto company an access token is scoped to.
 *
 * `/v1/me` was removed from the current API; `/v1/token_info` is its
 * replacement, returning the token's `resource` (the company, for the
 * authorization-code grant a founder completes) instead of a role/company
 * list. See https://docs.gusto.com/app-integrations/reference/get-v1-token-info.
 */
export const getGustoAuthorizedCompanies = async (
  accessToken: string
): Promise<Array<{ uuid: string }>> => {
  const info = await gustoGet<GustoTokenInfo>(accessToken, "/v1/token_info");

  if (info.resource?.type !== "Company" || !info.resource.uuid) {
    return [];
  }

  return [{ uuid: info.resource.uuid }];
};
