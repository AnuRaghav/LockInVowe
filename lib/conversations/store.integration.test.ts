import { beforeAll, describe, expect, it } from "vitest";
import { createConversationStore } from "@/lib/conversations/store";
import { createServiceClient } from "@/lib/supabase/service";

const enabled = Boolean(process.env.SUPABASE_INTEGRATION);
const COMPANY_ID = "00000000-0000-4000-8000-0000000000c1";

describe.skipIf(!enabled)("durable conversations against Postgres", () => {
  const db = enabled ? createServiceClient() : (null as never);

  beforeAll(async () => {
    const { error } = await db.from("conversation_threads").delete().eq("company_id", COMPANY_ID);
    if (error) throw error;
  });

  it("persists several turns and reconstructs them from a fresh store", async () => {
    const store = createConversationStore(db);
    const thread = await store.createThread(COMPANY_ID, "Runway planning");
    expect(await store.listThreads(COMPANY_ID)).toContainEqual(thread);

    const first = await store.begin(COMPANY_ID, "What is our runway?", thread.id);
    expect((await store.load(COMPANY_ID, first.threadId))?.messages.map(({ role, content }) => [role, content])).toEqual([
      ["user", "What is our runway?"],
    ]);
    await store.finish(COMPANY_ID, first.id, "completed", "Twelve months.");

    const second = await store.begin(COMPANY_ID, "What changes if we hire?", first.threadId);
    await store.finish(COMPANY_ID, second.id, "completed", "It falls to ten months.");

    // A new adapter has no process-local state: all reconstruction is from Postgres.
    const reopened = await createConversationStore(db).load(COMPANY_ID, thread.id);
    expect(reopened?.thread.name).toBe("Runway planning");
    expect(reopened?.messages.map(({ role, content }) => [role, content])).toEqual([
      ["user", "What is our runway?"],
      ["assistant", "Twelve months."],
      ["user", "What changes if we hire?"],
      ["assistant", "It falls to ten months."],
    ]);
    expect(reopened?.runs.map(({ status }) => status)).toEqual(["completed", "completed"]);
    expect(reopened?.messages.every(({ createdAt }) => !Number.isNaN(Date.parse(createdAt)))).toBe(true);
    expect(reopened?.runs.every(({ startedAt, finishedAt }) => !Number.isNaN(Date.parse(startedAt)) && Boolean(finishedAt))).toBe(true);
  });
});
