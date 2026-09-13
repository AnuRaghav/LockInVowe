import { afterEach, describe, expect, it, vi } from "vitest";

import { sendMessage } from "@/lib/chat/client";

afterEach(() => vi.unstubAllGlobals());

describe("text conversation streaming", () => {
  it("yields text before the response closes, including split UTF-8 frames", async () => {
    let controller!: ReadableStreamDefaultController<Uint8Array>;
    const body = new ReadableStream<Uint8Array>({ start(value) { controller = value; } });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body));
    vi.stubGlobal("fetch", fetchMock);
    const stream = sendMessage({ content: "Hello", threadId: "thread-1" });
    const encoder = new TextEncoder();

    controller.enqueue(encoder.encode('2:[{"type":"thread","threadId":"thread-1"}]\n0:"First words"\n'));
    expect((await stream.next()).value).toEqual({ type: "thread", threadId: "thread-1" });
    expect((await stream.next()).value).toEqual({ type: "delta", text: "First words" });

    const nextFrame = encoder.encode('0:" — more"\n');
    const split = nextFrame.indexOf(0xe2) + 1;
    controller.enqueue(nextFrame.slice(0, split));
    controller.enqueue(nextFrame.slice(split));
    expect((await stream.next()).value).toEqual({ type: "delta", text: " — more" });
    controller.enqueue(encoder.encode('2:[{"type":"run_completed"}]\n'));
    controller.close();
    expect((await stream.next()).value).toEqual({ type: "run_completed", degraded: false });
    expect((await stream.next()).done).toBe(true);
    expect(fetchMock).toHaveBeenCalledOnce();
    expect(fetchMock).toHaveBeenCalledWith("/api/chat", expect.objectContaining({
      method: "POST", body: JSON.stringify({ content: "Hello", threadId: "thread-1" }),
    }));
  });

  it("passes cancellation to the request and propagates a stopped stream", async () => {
    const abort = new AbortController();
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        abort.signal.addEventListener("abort", () => controller.error(new DOMException("Stopped", "AbortError")));
      },
    });
    const fetchMock = vi.fn().mockResolvedValue(new Response(body));
    vi.stubGlobal("fetch", fetchMock);
    const stream = sendMessage({ content: "Hello", signal: abort.signal });
    const pending = stream.next();
    abort.abort();
    await expect(pending).rejects.toMatchObject({ name: "AbortError" });
    expect(fetchMock).toHaveBeenCalledWith("/api/chat", expect.objectContaining({ signal: abort.signal }));
  });
});
