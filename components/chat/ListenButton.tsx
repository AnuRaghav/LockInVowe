"use client";

import { SpeakerHigh, Stop } from "@phosphor-icons/react";
import { useVoicePlayback } from "@/components/chat/VoicePlayback";

export function ListenButton({ threadId, messageId }: { threadId: string; messageId: string }) {
  const { playback, play, stop } = useVoicePlayback();
  const active = playback?.messageId === messageId;
  return <button type="button" onClick={() => active ? stop() : play(threadId, messageId)}
    className="inline-flex w-fit items-center gap-1.5 rounded px-1 py-1 text-xs text-muted-2 hover:text-accent"
    aria-label={active ? "Stop audio" : "Listen to Sam's answer"}>
    {active ? <Stop size={16} /> : <SpeakerHigh size={16} />}
    {active ? "Stop audio" : "Listen"}
  </button>;
}
