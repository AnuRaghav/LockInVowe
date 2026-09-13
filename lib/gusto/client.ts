/**
 * Minimal Gusto REST client. Gusto has no official Node SDK, so this wraps
 * plain `fetch` against their OAuth2 + REST API. Sandbox by default - set
 * GUSTO_ENV=production to move off the demo API once real companies are
 * needed.
 */

const getGustoEnv = () => process.env.GUSTO_ENV ?? "sandbox";

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
    },
  });

  if (!response.ok) {
    throw new Error(`Gusto API request to ${path} failed: ${response.status} ${await response.text()}`);
  }

  return response.json();
};

/** The companies a Gusto access token has payroll-admin access to. */
export const getGustoAuthorizedCompanies = async (
  accessToken: string
): Promise<Array<{ uuid: string; name: string }>> => {
  const me = await gustoGet<{
    roles?: { payroll_admin?: { companies?: Array<{ uuid: string; name: string }> } };
  }>(accessToken, "/v1/me");

  return me.roles?.payroll_admin?.companies ?? [];
};
