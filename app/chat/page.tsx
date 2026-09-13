import type { Metadata } from "next";

import { ChatWorkspace } from "@/components/chat/ChatWorkspace";

export const metadata: Metadata = {
  title: "Sam | Chat",
  description: "Ask Sam about runway, hiring, and spend.",
};

/**
 * The canonical Sam conversation workspace.
 *
 * Reachable on its own (proxy.ts only requires a signed-in founder, never a
 * finished onboarding) so chat can be developed against the real thread API
 * while onboarding is built in parallel. `?thread=` carries the open
 * conversation across reloads and deep links.
 */
export default async function ChatPage({
  searchParams,
}: {
  searchParams: Promise<{ thread?: string | string[] }>;
}) {
  const { thread } = await searchParams;
  const threadId = (Array.isArray(thread) ? thread[0] : thread)?.trim();
  return <ChatWorkspace initialThreadId={threadId || undefined} />;
}
