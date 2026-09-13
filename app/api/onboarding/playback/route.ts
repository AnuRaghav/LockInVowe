import { InvalidAssumptionError } from "@/lib/company/assumptions";
import { resolveCompanyContext, type RequestIdentity } from "@/lib/company/context";
import {
  PlaybackCorrectionError,
  correctPlayback,
  loadOnboardingPlayback,
  playbackCorrectionSchema,
} from "@/lib/onboarding/playback";

export const runtime = "nodejs";

const identify = async (req: Request): Promise<RequestIdentity | null> => {
  try {
    return await resolveCompanyContext(req);
  } catch {
    return null;
  }
};

/** What Sam understood from onboarding, for the founder to check. */
export async function GET(req: Request) {
  const identity = await identify(req);
  if (!identity) return Response.json({ error: "Sign in required." }, { status: 401 });

  try {
    return Response.json(await loadOnboardingPlayback(identity));
  } catch (error) {
    console.error("Failed to load onboarding playback", error);
    return Response.json({ error: "Couldn't load what Sam understood." }, { status: 500 });
  }
}

/** Applies one correction, recorded as a correction, and returns the updated playback. */
export async function PATCH(req: Request) {
  const identity = await identify(req);
  if (!identity) return Response.json({ error: "Sign in required." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { correction?: unknown } | null;
  const parsed = playbackCorrectionSchema.safeParse(body?.correction);
  if (!parsed.success) {
    return Response.json({ error: "That change isn't valid.", issues: parsed.error.issues }, { status: 400 });
  }

  try {
    return Response.json(await correctPlayback(identity, parsed.data));
  } catch (error) {
    if (error instanceof PlaybackCorrectionError) {
      return Response.json({ error: error.message }, { status: error.status });
    }
    if (error instanceof InvalidAssumptionError) {
      return Response.json({ error: error.message }, { status: 400 });
    }
    console.error("Failed to apply onboarding correction", error);
    return Response.json({ error: "Couldn't save that change." }, { status: 500 });
  }
}
