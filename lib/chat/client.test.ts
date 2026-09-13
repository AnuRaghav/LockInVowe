import { afterEach, describe, expect, it, vi } from "vitest";

import { ChatRequestError, sendMessage } from "@/lib/chat/client";

/** Exactly the frames `app/api/chat/route.ts` writes, split across chunks. */
const streamed = (chunks: string[]): Response =>
  new Response(
    new ReadableStream<Uint8Array>({
      start(controller) {
        const encoder = new TextEncoder();
        for (const chunk of chunks) controller.enqueue(encoder.encode(chunk));
        controller.close();
      },
    }),
    { status: 200 },
  );

afterEach(() => vi.unstubAllGlobals());

describe("sendMessage", () => {
  it("sends only the thread and the new message, never the transcript", async () => {
    const fetchMock = vi.fn(async () => streamed(['0:"Fine."\n']));
    vi.stubGlobal("fetch", fetchMock);

    for await (const _ of sendMessage({ content: "How much cash?", threadId: "t-1" })) void _;

    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("/api/chat");
    expect(JSON.parse(String(init.body))).toEqual({ content: "How much cash?", threadId: "t-1" });
  });

  it("reads a multi-tool run the way the workspace consumes it", async () => {
    vi.stubGlobal("fetch", async () =>
      streamed([
        '2:[{"type":"thread","threadId":"t-9"}]\n2:[{"type":"run_started","runId":"r-1","seq":0}]\n',
        '2:[{"type":"tool_started","seq":1,"callId":"c1","name":"financial_position","kind":"read_only","label":"Reading observed financial position"}]\n',
        '2:[{"type":"tool_completed","seq":2,"callId":"c1","name":"financial_position","durationMs":12}]\n',
        // A frame split mid-flight by the network, which is the normal case.
        '0:"You have 14.2',
        ' months."\n2:[{"type":"run_completed","seq":3,"outcome":"completed","degraded":false}]\n',
      ]),
    );

    const events = [];
    for await (const event of sendMessage({ content: "runway?", threadId: "t-9" })) events.push(event);

    expect(events.map((event) => event.type)).toEqual([
      "thread",
      "run_started",
      "activity",
      "activity",
      "delta",
      "run_completed",
    ]);
    expect(events.filter((event) => event.type === "delta").map((event) => event.text).join("")).toBe(
      "You have 14.2 months.",
    );
  });

  it("surfaces a refused request as a typed error rather than a stream", async () => {
    vi.stubGlobal("fetch", async () =>
      Response.json({ error: "Thread already has a running turn" }, { status: 409 }),
    );

    const iterator = sendMessage({ content: "hi", threadId: "t-1" });
    await expect(iterator.next()).rejects.toThrow(ChatRequestError);
  });

  it("stops reading when the founder cancels", async () => {
    const controller = new AbortController();
    vi.stubGlobal("fetch", async (_input: string, init?: RequestInit) => {
      if (init?.signal?.aborted) throw new DOMException("Aborted", "AbortError");
      return streamed(['0:"partial"\n']);
    });

    controller.abort();
    await expect(sendMessage({ content: "hi", signal: controller.signal }).next()).rejects.toThrow(
      /abort/i,
    );
  });
});
