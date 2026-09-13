import { transcribe } from "@/lib/agents/sam/voice";
import { resolveAuthenticatedCompanyContext, UnauthenticatedError } from "@/lib/company/context";

export const runtime = "nodejs";
const MAX_BYTES = 10 * 1024 * 1024;
const AUDIO_TYPES = new Set(["audio/webm", "audio/mp4", "audio/ogg", "audio/wav", "audio/mpeg"]);

export async function POST(req: Request) {
  if (req.headers.get("sec-fetch-site") === "cross-site") return new Response(null, { status: 403 });
  try {
    await resolveAuthenticatedCompanyContext();
    const type = req.headers.get("content-type")?.split(";")[0].trim() ?? "";
    if (!AUDIO_TYPES.has(type)) return Response.json({ error: "Unsupported recording format." }, { status: 415 });
    // Bound memory even when Content-Length is missing or dishonest.
    const reader = req.body?.getReader();
    if (!reader) return Response.json({ error: "Recording required." }, { status: 400 });
    const chunks: Uint8Array<ArrayBuffer>[] = [];
    let size = 0;
    while (true) {
      const { value, done } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_BYTES) {
        await reader.cancel();
        return Response.json({ error: "Recording too large. Try a shorter message." }, { status: 413 });
      }
      chunks.push(new Uint8Array(value));
    }
    if (!size) return Response.json({ error: "Recording is empty." }, { status: 400 });
    const extension = type.split("/")[1];
    const text = await transcribe(new File(chunks, `recording.${extension}`, { type }), req.signal);
    if (text === null) return Response.json({ error: "Voice is not configured." }, { status: 503 });
    if (!text) return Response.json({ error: "No speech heard. Please try again." }, { status: 422 });
    return Response.json({ text }, { headers: { "Cache-Control": "no-store" } });
  } catch (error) {
    return Response.json({ error: error instanceof UnauthenticatedError ? "Sign in required." : "Transcription unavailable. Try again or type your message." },
      { status: error instanceof UnauthenticatedError ? 401 : 502 });
  }
}
