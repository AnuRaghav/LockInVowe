import { z } from "zod";

import { chartSpecSchema, type ChartSpec } from "@/lib/charts/spec";
import { createServiceClient } from "@/lib/supabase/service";
import type { Json } from "@/lib/supabase/types";

/**
 * Charts attached to conversation turns.
 *
 * A chart belongs to the run that drew it and is stored as its series, not as
 * an image - the chat draws it. That keeps the exact numbers inspectable and
 * the thread read a single small payload.
 */

const chartSchema = z.object({
  id: z.string(), run_id: z.string(), spec: chartSpecSchema, created_at: z.string(),
}).transform((row) => ({ id: row.id, runId: row.run_id, spec: row.spec, createdAt: row.created_at }));

export type ConversationChart = z.infer<typeof chartSchema>;

export interface NewConversationChart {
  companyId: string;
  threadId: string;
  runId: string;
  spec: ChartSpec;
}

export interface ConversationChartStore {
  save(chart: NewConversationChart): Promise<ConversationChart>;
  listForThread(companyId: string, threadId: string): Promise<ConversationChart[]>;
}

/**
 * Puts each chart beside the answer its run produced. A run's answer is the
 * message right after its user message: `conversation_begin` allows one
 * running turn per thread, so nothing can land in between. Charts from runs
 * that never produced an answer (failed, cancelled) are not shown.
 */
export const attachChartsToMessages = <M extends { id: string; role: "user" | "assistant" }>(
  messages: M[],
  runs: Array<{ id: string; userMessageId: string; status: string }>,
  charts: ConversationChart[],
): Array<M & { charts: Array<{ id: string; spec: ChartSpec }> }> => {
  const answerForRun = new Map<string, string>();
  const indexById = new Map(messages.map((message, index) => [message.id, index]));
  for (const run of runs) {
    if (run.status !== "completed") continue;
    const next = messages[(indexById.get(run.userMessageId) ?? -2) + 1];
    if (next?.role === "assistant") answerForRun.set(run.id, next.id);
  }

  const chartsByMessage = new Map<string, Array<{ id: string; spec: ChartSpec }>>();
  for (const chart of charts) {
    const messageId = answerForRun.get(chart.runId);
    if (!messageId) continue;
    chartsByMessage.set(messageId, [...(chartsByMessage.get(messageId) ?? []), { id: chart.id, spec: chart.spec }]);
  }

  return messages.map((message) => ({ ...message, charts: chartsByMessage.get(message.id) ?? [] }));
};

/** Server-only. Every read and write is confined to the trusted company id. */
export function createConversationChartStore(db = createServiceClient()): ConversationChartStore {
  return {
    async save({ companyId, threadId, runId, spec }) {
      // The run must be this company's, in this thread, and still in flight - a
      // chart can't be attached to someone else's conversation or a closed turn.
      const { data: run, error: runError } = await db.from("conversation_runs")
        .select("id, status, conversation_threads!inner(company_id)")
        .eq("id", runId).eq("thread_id", threadId)
        .eq("conversation_threads.company_id", companyId).maybeSingle();
      if (runError) throw new Error(`Chart storage: ${runError.message}`);
      if (!run || run.status !== "running") throw new Error("This turn can no longer take a chart.");

      const { data, error } = await db.from("conversation_charts").insert({
        company_id: companyId, thread_id: threadId, run_id: runId,
        title: spec.title, chart_type: spec.type, spec: spec as unknown as Json,
      }).select("id, run_id, spec, created_at").single();
      if (error) throw new Error(`Chart storage: ${error.message}`);
      return chartSchema.parse(data);
    },

    async listForThread(companyId, threadId) {
      const { data, error } = await db.from("conversation_charts")
        .select("id, run_id, spec, created_at")
        .eq("company_id", companyId).eq("thread_id", threadId)
        .order("created_at").order("id");
      if (error) throw new Error(`Chart storage: ${error.message}`);
      return z.array(chartSchema).parse(data);
    },
  };
}
