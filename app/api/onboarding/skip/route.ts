import { resolveCompanyContext } from "@/lib/company/context";
import { skipOnboarding } from "@/lib/onboarding/playback";

export const runtime = "nodejs";

/** Anything already said is consolidated before skipping, which can take a model call per section. */
export const maxDuration = 120;

/** Skips the remaining interview questions; Sam picks them up in conversation later. */
export async function POST(req: Request) {
  let identity;
  try {
    identity = await resolveCompanyContext(req);
  } catch {
    return Response.json({ error: "Sign in required." }, { status: 401 });
  }

  try {
    return Response.json(await skipOnboarding(identity));
  } catch (error) {
    console.error("Failed to skip onboarding", error);
    return Response.json({ error: "Couldn't skip onboarding. Try again." }, { status: 500 });
  }
}
