import { resolveCompanyContext } from "@/lib/company/context";
import { OnboardingNotReadyError, completeOnboarding } from "@/lib/onboarding/playback";

export const runtime = "nodejs";

/** Finishes onboarding once the interview has covered every section. */
export async function POST(req: Request) {
  let identity;
  try {
    identity = await resolveCompanyContext(req);
  } catch {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    return Response.json(await completeOnboarding(identity));
  } catch (error) {
    if (error instanceof OnboardingNotReadyError) {
      return Response.json({ error: error.message }, { status: 409 });
    }
    console.error("Failed to complete onboarding", error);
    return Response.json({ error: "Couldn't finish onboarding. Try again." }, { status: 500 });
  }
}
