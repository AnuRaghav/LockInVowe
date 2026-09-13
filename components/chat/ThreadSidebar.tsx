"use client";

import Link from "next/link";
import { NotePencil } from "@phosphor-icons/react";

import { SamLogo } from "@/components/SamLogo";
import type { ChatThread } from "@/lib/chat/client";
import { cn } from "@/lib/utils";

/** Threads carry no name until someone gives them one; nothing is inferred. */
export const threadLabel = (thread: ChatThread) => thread.name?.trim() || "Untitled conversation";

/**
 * Deliberately thin: list, select, create. Anything that would turn this into
 * a file manager (folders, search, archive, metadata) is out of scope - the
 * conversation is the product, the sidebar is just the way back to one.
 */
export function ThreadSidebar({
  threads,
  activeThreadId,
  loading,
  creating,
  locked,
  open,
  onClose,
  onSelect,
  onCreate,
}: {
  threads: ChatThread[];
  activeThreadId: string | null;
  loading: boolean;
  creating: boolean;
  /** A run is in flight, so leaving this conversation would abandon it. */
  locked: boolean;
  /** Below md the sidebar is a drawer; above it, always in place. */
  open: boolean;
  onClose: () => void;
  onSelect: (threadId: string) => void;
  onCreate: () => void;
}) {
  return (
    <>
      {open && (
        <button
          type="button"
          aria-label="Close conversations"
          onClick={onClose}
          className="fixed inset-0 z-20 bg-black/50 md:hidden"
        />
      )}
      <aside
        className={cn(
          "z-30 flex h-full w-[264px] flex-none flex-col border-r border-border bg-[#1f2220] transition-transform duration-200 md:static md:translate-x-0 md:bg-black/15",
          "fixed inset-y-0 left-0",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
        )}
      >
        <div className="flex h-16 flex-none items-center justify-between px-4">
          <Link href="/" aria-label="Sam home" className="inline-flex shrink-0 items-center">
            <SamLogo />
          </Link>
          <button
            type="button"
            onClick={onCreate}
            disabled={creating || locked}
            title={locked ? "Sam is working in this conversation" : "New conversation"}
            aria-label="New conversation"
            className="inline-flex h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-foreground disabled:opacity-50"
          >
            <NotePencil className="h-[18px] w-[18px]" />
          </button>
        </div>

        <nav aria-label="Conversations" className="flex-1 overflow-y-auto px-2 pb-4">
          {loading && threads.length === 0 ? (
            <p className="px-2 py-2 text-[13px] text-muted-2">Loading conversations…</p>
          ) : threads.length === 0 ? (
            <p className="px-2 py-2 text-[13px] leading-relaxed text-muted-2">
              No conversations yet. Ask Sam something to start one.
            </p>
          ) : (
            <ul className="flex flex-col gap-0.5">
              {threads.map((thread) => {
                const active = thread.id === activeThreadId;
                return (
                  <li key={thread.id}>
                    <button
                      type="button"
                      onClick={() => onSelect(thread.id)}
                      aria-current={active ? "page" : undefined}
                      aria-disabled={locked && !active}
                      title={locked && !active ? "Sam is working — stop the current answer to switch" : undefined}
                      className={cn(
                        "w-full truncate rounded-lg px-2.5 py-2 text-left text-[13px] transition-colors",
                        active
                          ? "bg-surface-strong font-medium text-foreground"
                          : "text-muted hover:bg-surface hover:text-foreground",
                        locked && !active && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted",
                      )}
                    >
                      {threadLabel(thread)}
                    </button>
                  </li>
                );
              })}
            </ul>
          )}
        </nav>
      </aside>
    </>
  );
}
