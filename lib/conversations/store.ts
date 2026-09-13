import { z } from "zod";
import { createServiceClient } from "@/lib/supabase/service";

const threadSchema = z.object({
  id: z.string(), name: z.string().nullable(), created_at: z.string(),
}).transform((row) => ({ id: row.id, name: row.name, createdAt: row.created_at }));

const messageSchema = z.object({
  id: z.string(), thread_id: z.string(), role: z.enum(["user", "assistant"]),
  content: z.string(), created_at: z.string(),
}).transform((row) => ({
  id: row.id, threadId: row.thread_id, role: row.role,
  content: row.content, createdAt: row.created_at,
}));
const runSchema = z.object({
  id: z.string(), thread_id: z.string(), user_message_id: z.string(),
  status: z.enum(["running", "completed", "failed", "cancelled"]),
  started_at: z.string(), finished_at: z.string().nullable(),
}).transform((row) => ({
  id: row.id, threadId: row.thread_id, userMessageId: row.user_message_id,
  status: row.status, startedAt: row.started_at, finishedAt: row.finished_at,
}));
export type Thread = z.infer<typeof threadSchema>;
export type Message = z.infer<typeof messageSchema>;
export type Run = z.infer<typeof runSchema>;
export type Conversation = { thread: Thread; messages: Message[]; runs: Run[] };
export type TerminalStatus = Exclude<Run["status"], "running">;

export class ConversationError extends Error {
  constructor(message: string, readonly status: number) { super(message); }
}

export interface ConversationStore {
  createThread(companyId: string, name?: string): Promise<Thread>;
  listThreads(companyId: string): Promise<Thread[]>;
  begin(companyId: string, content: string, threadId?: string): Promise<Run>;
  load(companyId: string, threadId: string): Promise<Conversation | null>;
  finish(companyId: string, runId: string, status: TerminalStatus, content?: string): Promise<void>;
}

const checkError = (error: { code?: string; message: string } | null) => {
  if (!error) return;
  if (error.code === "PT404") throw new ConversationError("Thread not found", 404);
  if (error.code === "PT409") throw new ConversationError("Thread already has a running turn", 409);
  throw new Error(`Conversation storage: ${error.message}`);
};

/** Server-only durable storage. Never silently fall back to process memory. */
export function createConversationStore(db = createServiceClient()): ConversationStore {
  return {
    async createThread(companyId, name) {
      const { data, error } = await db.from("conversation_threads")
        .insert({ company_id: companyId, name: name?.trim() || null })
        .select("id, name, created_at").single();
      checkError(error);
      return threadSchema.parse(data);
    },
    async listThreads(companyId) {
      const threads: Thread[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await db.from("conversation_threads")
          .select("id, name, created_at").eq("company_id", companyId)
          .order("created_at", { ascending: false }).order("id").range(offset, offset + 499);
        checkError(error);
        threads.push(...z.array(threadSchema).parse(data));
        if (data!.length < 500) break;
      }
      return threads;
    },
    async begin(companyId, content, threadId) {
      const { data, error } = await db.rpc("conversation_begin", {
        p_company_id: companyId, p_content: content, p_thread_id: threadId,
      });
      checkError(error);
      return runSchema.parse(data);
    },
    async load(companyId, threadId) {
      const { data: thread, error } = await db.from("conversation_threads")
        .select("id, name, created_at").eq("id", threadId).eq("company_id", companyId).maybeSingle();
      checkError(error);
      if (!thread) return null;
      // Explicit paging avoids silently losing history at PostgREST's row limit.
      const messages: Message[] = [];
      const runs: Run[] = [];
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await db.from("conversation_messages").select("*")
          .eq("thread_id", threadId).order("position").range(offset, offset + 499);
        checkError(error);
        messages.push(...z.array(messageSchema).parse(data));
        if (data!.length < 500) break;
      }
      for (let offset = 0; ; offset += 500) {
        const { data, error } = await db.from("conversation_runs").select("*")
          .eq("thread_id", threadId).order("started_at").order("id").range(offset, offset + 499);
        checkError(error);
        runs.push(...z.array(runSchema).parse(data));
        if (data!.length < 500) break;
      }
      return { thread: threadSchema.parse(thread), messages, runs };
    },
    async finish(companyId, runId, status, content) {
      const { error } = await db.rpc("conversation_finish", {
        p_company_id: companyId, p_run_id: runId, p_status: status, p_content: content,
      });
      checkError(error);
    },
  };
}
