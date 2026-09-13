import { beforeEach, describe, expect, it, vi } from "vitest";

const mocks = vi.hoisted(() => ({ auth: vi.fn(), load: vi.fn(), speak: vi.fn(), transcribe: vi.fn() }));
vi.mock("@/lib/company/context", () => ({
  resolveAuthenticatedCompanyContext: mocks.auth,
  UnauthenticatedError: class extends Error {},
}));
vi.mock("@/lib/conversations/store", () => ({ createConversationStore: () => ({ load: mocks.load }) }));
vi.mock("@/lib/agents/sam/voice", () => ({ speak: mocks.speak, transcribe: mocks.transcribe }));
import { GET } from "@/app/api/voice/speech/route";
import { POST } from "@/app/api/voice/transcribe/route";
import { UnauthenticatedError } from "@/lib/company/context";

beforeEach(() => {
  vi.resetAllMocks();
  mocks.auth.mockResolvedValue({ companyId: "owner" });
});
describe("voice presentation routes", () => {
  it("streams the saved assistant text, scoped to authenticated company", async () => {
    mocks.load.mockResolvedValue({ messages: [{ id: "answer", role: "assistant", content: "Canonical answer" }] });
    mocks.speak.mockResolvedValue(new ReadableStream({ start(controller) { controller.enqueue(new Uint8Array([1, 2])); controller.close(); } }));
    const response = await GET(new Request("http://localhost/api/voice/speech?threadId=thread&messageId=answer&text=untrusted"));
    expect(mocks.load).toHaveBeenCalledWith("owner", "thread");
    expect(mocks.speak).toHaveBeenCalledWith("Canonical answer", expect.any(AbortSignal));
    expect(response.headers.get("content-type")).toBe("audio/mpeg");
    expect(response.headers.get("cache-control")).toContain("no-store");
    expect((await response.arrayBuffer()).byteLength).toBe(2);
  });
  it("does not speak inaccessible threads or user messages", async () => {
    for (const data of [null, { messages: [{ id: "answer", role: "user", content: "User input" }] }]) {
      mocks.load.mockResolvedValue(data);
      expect((await GET(new Request("http://localhost/api/voice/speech?threadId=thread&messageId=answer"))).status).toBe(404);
    }
    expect(mocks.speak).not.toHaveBeenCalled();
  });
  it("requires authentication for both routes", async () => {
    mocks.auth.mockRejectedValue(new UnauthenticatedError());
    expect((await GET(new Request("http://localhost/api/voice/speech"))).status).toBe(401);
    expect((await POST(new Request("http://localhost/api/voice/transcribe", { method: "POST" }))).status).toBe(401);
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it("returns a transcript without creating a conversation", async () => {
    mocks.transcribe.mockResolvedValue("What is our runway?");
    const response = await POST(new Request("http://localhost/api/voice/transcribe", { method: "POST", body: new Blob(["audio"], { type: "audio/webm" }) }));
    expect(await response.json()).toEqual({ text: "What is our runway?" });
    expect(mocks.transcribe).toHaveBeenCalledWith(expect.any(File), expect.any(AbortSignal));
    expect(mocks.load).not.toHaveBeenCalled();
  });
  it("rejects unsupported and oversized recordings before calling ElevenLabs", async () => {
    for (const [type, body, status] of [["text/plain", "audio", 415], ["audio/webm", new Uint8Array(10 * 1024 * 1024 + 1), 413]] as const) {
      expect((await POST(new Request("http://localhost/api/voice/transcribe", { method: "POST", body, headers: { "content-type": type } }))).status).toBe(status);
    }
    expect(mocks.transcribe).not.toHaveBeenCalled();
  });
  it("makes provider failures recoverable without leaking details", async () => {
    mocks.transcribe.mockRejectedValue(new Error("private provider details"));
    const response = await POST(new Request("http://localhost/api/voice/transcribe", { method: "POST", body: new Blob(["audio"], { type: "audio/webm" }) }));
    expect(response.status).toBe(502);
    expect(await response.text()).not.toContain("private provider details");
  });
});
