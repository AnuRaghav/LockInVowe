import { resolveCompanyContext } from "@/lib/company/context";
import {
  buildGustoAuthorizeUrl,
  encodeGustoOAuthState,
  toGustoReturnPath,
} from "@/lib/gusto/client";

/**
 * Starts the Gusto OAuth flow. Redirects straight to Gusto's authorize
 * screen; `state` carries the company id and the page to return to
 * (`?returnTo=/onboarding` or `/connect`) through the redirect.
 */
export async function GET(req: Request) {
  let companyId: string;
  try {
    companyId = (await resolveCompanyContext(req)).companyId;
  } catch {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }
  const returnTo = toGustoReturnPath(new URL(req.url).searchParams.get("returnTo"));

  try {
    return Response.redirect(
      buildGustoAuthorizeUrl(encodeGustoOAuthState(companyId, returnTo))
    );
  } catch (error) {
    console.error("Failed to build Gusto authorize URL", error);
    return Response.json({ error: "Gusto is not configured." }, { status: 500 });
  }
}
