"use client";

import Link from "next/link";
import { useEffect, useRef, useState } from "react";
import { NotePencil, PencilSimple, SidebarSimple, Trash } from "@phosphor-icons/react";

import { SamLogo } from "@/components/SamLogo";
import type { ChatThread } from "@/lib/chat/client";
import { cn } from "@/lib/utils";

/** Threads are named from their first message; this covers the moment before that. */
export const threadLabel = (thread: ChatThread) => thread.name?.trim() || "New conversation";

const iconButton =
  "inline-flex h-7 w-7 flex-none items-center justify-center rounded-md text-muted-2 transition-colors hover:bg-surface-strong hover:text-foreground disabled:opacity-40";

function ThreadRow({
  thread,
  active,
  locked,
  onSelect,
  onRename,
  onDelete,
}: {
  thread: ChatThread;
  active: boolean;
  locked: boolean;
  onSelect: () => void;
  onRename: (name: string) => Promise<void>;
  onDelete: () => Promise<void>;
}) {
  const [editing, setEditing] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  /** Enter, Escape, and blur can all end one edit; only the first one counts. */
  const settled = useRef(false);

  useEffect(() => {
    if (editing) input.current?.select();
  }, [editing]);

  useEffect(() => {
    if (!confirming) return;
    const timer = setTimeout(() => setConfirming(false), 3000);
    return () => clearTimeout(timer);
  }, [confirming]);

  const finishEdit = (save: boolean) => {
    if (settled.current) return;
    settled.current = true;
    const next = input.current?.value.trim() ?? "";
    setEditing(false);
    if (save && next && next !== thread.name) void onRename(next);
  };

  // Deleting the conversation Sam is answering in would orphan the run.
  const deleteLocked = locked && active;

  if (editing) {
    return (
      <li>
        <input
          ref={input}
          defaultValue={threadLabel(thread)}
          maxLength={80}
          aria-label="Conversation name"
          onBlur={() => finishEdit(true)}
          onKeyDown={(event) => {
            if (event.key === "Enter") finishEdit(true);
            if (event.key === "Escape") finishEdit(false);
          }}
          className="w-full rounded-lg border border-border-strong bg-surface-strong px-2.5 py-[7px] text-[13px] text-foreground outline-none focus:border-accent"
        />
      </li>
    );
  }

  return (
    <li className="group relative">
      <button
        type="button"
        onClick={onSelect}
        aria-current={active ? "page" : undefined}
        aria-disabled={locked && !active}
        title={locked && !active ? "Sam is working — stop the current answer to switch" : threadLabel(thread)}
        className={cn(
          "w-full truncate rounded-lg py-2 pl-2.5 pr-16 text-left text-[13px] transition-colors",
          active ? "bg-surface-strong font-medium text-foreground" : "text-muted hover:bg-surface hover:text-foreground",
          locked && !active && "cursor-not-allowed opacity-50 hover:bg-transparent hover:text-muted",
        )}
      >
        {threadLabel(thread)}
      </button>
      <div
        className={cn(
          "absolute inset-y-0 right-1 flex items-center gap-0.5 transition-opacity",
          confirming ? "opacity-100" : "opacity-0 focus-within:opacity-100 group-hover:opacity-100",
        )}
      >
        {confirming ? (
          <button
            type="button"
            onClick={() => {
              setConfirming(false);
              void onDelete();
            }}
            className="rounded-md bg-danger-soft px-2 py-1 text-[12px] font-medium text-danger transition-colors hover:bg-danger/25"
          >
            Delete
          </button>
        ) : (
          <>
            <button
              type="button"
              aria-label={`Rename ${threadLabel(thread)}`}
              title="Rename"
              onClick={() => {
                settled.current = false;
                setEditing(true);
              }}
              className={iconButton}
            >
              <PencilSimple className="h-3.5 w-3.5" />
            </button>
            <button
              type="button"
              aria-label={`Delete ${threadLabel(thread)}`}
              title={deleteLocked ? "Sam is working in this conversation" : "Delete"}
              disabled={deleteLocked}
              onClick={() => setConfirming(true)}
              className={cn(iconButton, "hover:text-danger")}
            >
              <Trash className="h-3.5 w-3.5" />
            </button>
          </>
        )}
      </div>
    </li>
  );
}

/**
 * Deliberately thin: list, select, create, rename, delete. Anything that would
 * turn this into a file manager (folders, search, archive) is out of scope -
 * the conversation is the product, the sidebar is just the way back to one.
 */
export function ThreadSidebar({
  threads,
  activeThreadId,
  loading,
  creating,
  locked,
  open,
  collapsed,
  onClose,
  onToggleCollapsed,
  onSelect,
  onCreate,
  onRename,
  onDelete,
}: {
  threads: ChatThread[];
  activeThreadId: string | null;
  loading: boolean;
  creating: boolean;
  /** A run is in flight, so leaving this conversation would abandon it. */
  locked: boolean;
  /** Below md the sidebar is a drawer. */
  open: boolean;
  /** At md and up the sidebar folds away to give the conversation the width. */
  collapsed: boolean;
  onClose: () => void;
  onToggleCollapsed: () => void;
  onSelect: (threadId: string) => void;
  onCreate: () => void;
  onRename: (threadId: string, name: string) => Promise<void>;
  onDelete: (threadId: string) => Promise<void>;
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
        aria-hidden={collapsed ? true : undefined}
        inert={collapsed}
        className={cn(
          "fixed inset-y-0 left-0 z-30 h-full w-[264px] flex-none overflow-hidden bg-[#1f2220] transition-[transform,width] duration-300 ease-[cubic-bezier(0.22,1,0.36,1)] motion-reduce:transition-none",
          "md:static md:translate-x-0 md:bg-black/15",
          open ? "translate-x-0" : "-translate-x-full md:translate-x-0",
          collapsed ? "md:w-0" : "md:w-[264px] md:border-r md:border-border",
        )}
      >
        {/* Fixed width inside, so content slides out rather than reflowing as the rail narrows. */}
        <div className="flex h-full w-[264px] flex-col">
          <div className="flex h-16 flex-none items-center justify-between gap-1 px-4">
            <Link href="/" aria-label="Sam home" className="inline-flex shrink-0 items-center">
              <SamLogo />
            </Link>
            <div className="flex items-center gap-0.5">
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
              <button
                type="button"
                onClick={onToggleCollapsed}
                title="Hide sidebar"
                aria-label="Hide sidebar"
                className="hidden h-8 w-8 items-center justify-center rounded-lg text-muted transition-colors hover:bg-surface hover:text-foreground md:inline-flex"
              >
                <SidebarSimple className="h-[18px] w-[18px]" />
              </button>
            </div>
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
                {threads.map((thread) => (
                  <ThreadRow
                    key={thread.id}
                    thread={thread}
                    active={thread.id === activeThreadId}
                    locked={locked}
                    onSelect={() => onSelect(thread.id)}
                    onRename={(name) => onRename(thread.id, name)}
                    onDelete={() => onDelete(thread.id)}
                  />
                ))}
              </ul>
            )}
          </nav>
        </div>
      </aside>
    </>
  );
}
