/**
 * Hex public API client.
 *
 * Hex publishes an OpenAPI document (https://static.hex.site/openapi.json) but
 * no JavaScript SDK. The spec is vendored at `lib/hex/openapi.json` and
 * `lib/hex/schema.d.ts` is generated from it, so every path, parameter, and
 * response below is typed straight from Hex's own contract. Refresh both with
 * `npm run hex:spec && npm run hex:types`.
 *
 * Auth is a bearer token tied to a Hex user: a workspace token (`hxtw_`,
 * admin-created, can be non-expiring) for server automation, or a personal
 * access token (`hxtp_`, expires in 7-120 days). Hex allows 60 requests per
 * minute per user and 25 concurrent kernels, returning 429 / 503 past those.
 *
 * Nothing calls this yet - it is the wiring for Hex-backed data insights.
 */

import createClient, { type Client } from "openapi-fetch";
import type { components, operations, paths } from "./schema";

export type { components, operations, paths };

/** Multi-tenant Hex. Single-tenant, EU, and HIPAA workspaces use their own host. */
const DEFAULT_HEX_API_BASE_URL = "https://app.hex.tech/api";

const getHexConfig = () => {
  const token = process.env.HEX_API_TOKEN;
  if (!token) {
    throw new Error("Missing Hex credentials. Set HEX_API_TOKEN in .env.local.");
  }

  // Spec paths already start with `/v1`, so the base stops at `/api`.
  const baseUrl = (process.env.HEX_API_BASE_URL ?? DEFAULT_HEX_API_BASE_URL).replace(/\/+$/, "");
  return { token, baseUrl };
};

export const isHexConfigured = (): boolean => Boolean(process.env.HEX_API_TOKEN);

export type HexClient = Client<paths>;

/**
 * Server-only: the token grants whatever its Hex user can do, so never build
 * this in a client component.
 *
 * @example
 *   const { data, error } = await createHexClient().GET("/v1/projects/{projectId}", {
 *     params: { path: { projectId } },
 *   });
 */
export const createHexClient = (): HexClient => {
  const { token, baseUrl } = getHexConfig();
  return createClient<paths>({
    baseUrl,
    headers: { Authorization: `Bearer ${token}` },
  });
};
