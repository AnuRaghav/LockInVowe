"use client";

import { useEffect, useRef } from "react";

import { SamOrb } from "@/components/SamOrb";
import type { ChatMessage } from "@/lib/chat/client";

/**
 * A founder's own words read as a short aside; Sam's answers are the
 * document. So user turns get a light chat treatment and Sam's get the full
 * reading column with no bubble around them - structured figures and charts
 * will land in that column later without being boxed in.
 */
function UserTurn({ content }: { content: string }) {
  return (
    <div className="flex justify-end">
      <p className="max-w-[85%] whitespace-pre-wrap rounded-2xl rounded-br-md border border-border bg-surface-strong px-4 py-2.5 text-[15px] leading-relaxed text-foreground">
        {content}
      </p>
    </div>
  );
}

function SamTurn({ content, pending = false }: { content: string; pending?: boolean }) {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-2">Sam</span>
      <div className="whitespace-pre-wrap text-[16px] leading-[1.7] text-foreground">
        {content}
        {pending && (
          <span
            aria-hidden
            className="ml-0.5 inline-block h-[1.05em] w-[2px] translate-y-[0.16em] animate-pulse bg-accent"
          />
        )}
      </div>
    </div>
  );
}

function Working() {
  return (
    <div className="flex flex-col gap-2.5">
      <span className="text-[11px] font-medium uppercase tracking-[0.14em] text-muted-2">Sam</span>
      <span className="text-[15px] text-muted-2">Thinking…</span>
    </div>
  );
}

export function MessageList({
  messages,
  streamingText,
  running = false,
}: {
  messages: ChatMessage[];
  streamingText?: string;
  running?: boolean;
}) {
  const bottomRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    bottomRef.current?.scrollIntoView({ block: "end" });
  }, [messages, streamingText, running]);

  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-col gap-8 px-6 py-10">
      {messages.map((message) =>
        message.role === "user" ? (
          <UserTurn key={message.id} content={message.content} />
        ) : (
          <SamTurn key={message.id} content={message.content} />
        ),
      )}
      {running && (streamingText ? <SamTurn content={streamingText} pending /> : <Working />)}
      <div ref={bottomRef} />
    </div>
  );
}

/** Shown for a brand-new thread, and for `/chat` before anything is selected. */
export function EmptyConversation({ hint }: { hint: string }) {
  return (
    <div className="mx-auto flex w-full max-w-[46rem] flex-1 flex-col items-center justify-center gap-5 px-6 py-16 text-center">
      <SamOrb energy={0.3} points={360} className="h-32 w-32" />
      <div className="flex flex-col gap-2">
        <h2 className="text-balance text-2xl font-semibold tracking-tight text-foreground">
          What do you want to know?
        </h2>
        <p className="max-w-[44ch] text-[15px] leading-relaxed text-muted">{hint}</p>
      </div>
    </div>
  );
}
