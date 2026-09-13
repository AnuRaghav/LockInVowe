"use client";

import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from "react";

type Playback = { messageId: string; state: "loading" | "speaking" } | null;
type VoicePlayback = { playback: Playback; error: string | null; play: (threadId: string, messageId: string) => void; stop: () => void };
const Context = createContext<VoicePlayback | null>(null);

export function VoicePlaybackProvider({ children }: { children: ReactNode }) {
  const audio = useRef<HTMLAudioElement | null>(null);
  const [playback, setPlayback] = useState<Playback>(null);
  const [error, setError] = useState<string | null>(null);
  const stop = () => {
    const player = audio.current;
    audio.current = null;
    if (player) { player.pause(); player.removeAttribute("src"); player.load(); }
    setPlayback(null);
  };
  useEffect(() => () => {
    const player = audio.current;
    audio.current = null;
    if (player) { player.pause(); player.removeAttribute("src"); player.load(); }
  }, []);

  const play = (threadId: string, messageId: string) => {
    window.dispatchEvent(new Event("sam-playback-start"));
    stop();
    setError(null);
    setPlayback({ messageId, state: "loading" });
    const player = new Audio(`/api/voice/speech?${new URLSearchParams({ threadId, messageId })}`);
    audio.current = player;
    const failed = () => {
      if (audio.current !== player) return;
      stop();
      setError("Could not play audio. Try Listen again. Text chat still works.");
    };
    player.onplaying = () => { if (audio.current === player) setPlayback({ messageId, state: "speaking" }); };
    player.onended = () => { if (audio.current === player) stop(); };
    player.onerror = failed;
    void player.play().catch(failed);
  };
  return <Context.Provider value={{ playback, error, play, stop }}>{children}</Context.Provider>;
}

export function useVoicePlayback() {
  const context = useContext(Context);
  if (!context) throw new Error("VoicePlaybackProvider required");
  return context;
}
