import { resolveCompanyContext } from "@/lib/company/context";
import { buildGustoAuthorizeUrl } from "@/lib/gusto/client";

/**
 * Starts the Gusto OAuth flow. Redirects straight to Gusto's authorize
 * screen; `state` carries the company id back through the redirect so the
 * callback knows which company to attach the connection to.
 *
 * TEMPORARY: `state` is just the company id, with no signature. Fine while
 * there is one dev company and no session to forge (see lib/company/context.ts);
 * replace with a signed, single-use state token once auth exists.
 */
export async function GET(req: Request) {
  const { companyId } = resolveCompanyContext(req);

  try {
    return Response.redirect(buildGustoAuthorizeUrl(companyId));
  } catch (error) {
    console.error("Failed to build Gusto authorize URL", error);
    return Response.json(
      { error: "Gusto is not configured." },
      { status: 500 }
    );
  }
}
