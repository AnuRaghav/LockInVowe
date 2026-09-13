import { resolveCompanyContext, type RequestIdentity } from "@/lib/company/context";
import { runOnboardingTurn } from "@/lib/onboarding/interview";
import { createOnboardingSessionStore } from "@/lib/onboarding/sessions";
import { describeInterview } from "@/lib/onboarding/state";

export const runtime = "nodejs";

/** One turn is a model run, plus consolidation when a section closes. */
export const maxDuration = 120;

const MAX_MESSAGE_CHARS = 4000;

const identify = async (req: Request): Promise<RequestIdentity | null> => {
  try {
    return await resolveCompanyContext(req);
  } catch {
    return null;
  }
};

/** The interview so far, for opening or resuming the onboarding chat. */
export async function GET(req: Request) {
  const identity = await identify(req);
  if (!identity) return Response.json({ error: "Sign in required." }, { status: 401 });

  try {
    const session = await createOnboardingSessionStore().getCurrent(identity);
    return Response.json(describeInterview(session));
  } catch (error) {
    console.error("Failed to load onboarding interview", error);
    return Response.json({ error: "Couldn't load onboarding." }, { status: 500 });
  }
}

/**
 * One interview turn. Send `{ message }` to answer, or `{}` to open or resume.
 * Founder and company come from Auth; nothing in the body can choose them.
 */
export async function POST(req: Request) {
  const identity = await identify(req);
  if (!identity) return Response.json({ error: "Sign in required." }, { status: 401 });

  const body = (await req.json().catch(() => null)) as { message?: unknown } | null;
  if (!body || typeof body !== "object") {
    return Response.json({ error: "Invalid request." }, { status: 400 });
  }

  const { message } = body;
  if (message !== undefined && (typeof message !== "string" || message.length > MAX_MESSAGE_CHARS)) {
    return Response.json({ error: `A message must be text of at most ${MAX_MESSAGE_CHARS} characters.` }, { status: 400 });
  }

  try {
    const turn = await runOnboardingTurn({ identity, message, signal: req.signal });
    const session = await createOnboardingSessionStore().getCurrent(identity);

    return Response.json({
      ...turn,
      interview: describeInterview(session),
      ...(!turn.ok && { error: "Sam couldn't reply just then. Try sending that again." }),
    });
  } catch (error) {
    console.error("Onboarding turn failed", error);
    return Response.json({ error: "Sam couldn't reply just then. Try sending that again." }, { status: 500 });
  }
}
