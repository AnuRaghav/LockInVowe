"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { SamOrb } from "@/components/SamOrb";
import { useVoicePlayback } from "@/components/chat/VoicePlayback";
import { cn } from "@/lib/utils";

type Session = { controller: AbortController; stream?: MediaStream; recorder?: MediaRecorder; timer?: ReturnType<typeof setTimeout> };

export function VoiceInput({ disabled, running, onStop, onTranscript, variant = "dock" }: {
  disabled: boolean; running: boolean; onStop: () => void; onTranscript: (text: string) => void; variant?: "dock" | "hero";
}) {
  const { playback, error: playbackError, stop: stopPlayback } = useVoicePlayback();
  const [state, setState] = useState<"idle" | "starting" | "recording" | "transcribing">("idle");
  const [error, setError] = useState<string | null>(null);
  const session = useRef<Session | null>(null);
  const callback = useRef(onTranscript);
  useEffect(() => { callback.current = onTranscript; }, [onTranscript]);

  const release = (current: Session) => {
    clearTimeout(current.timer);
    current.stream?.getTracks().forEach(track => track.stop());
  };
  const cancel = () => {
    const current = session.current;
    session.current = null;
    if (current) {
      current.controller.abort();
      if (current.recorder?.state === "recording") current.recorder.stop();
      release(current);
    }
    setState("idle");
  };
  useEffect(() => {
    const abort = () => {
      const current = session.current;
      session.current = null;
      if (current) {
        current.controller.abort();
        if (current.recorder?.state === "recording") current.recorder.stop();
        release(current);
      }
    };
    const onPlayback = () => { abort(); setState("idle"); };
    window.addEventListener("sam-playback-start", onPlayback);
    return () => { window.removeEventListener("sam-playback-start", onPlayback); abort(); };
  }, []);

  const start = async () => {
    if (session.current || disabled || running) return;
    stopPlayback();
    const current: Session = { controller: new AbortController() };
    session.current = current;
    setError(null);
    setState("starting");
    try {
      if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === "undefined") {
        throw new Error("Recording is not supported here. Use a supported browser over HTTPS.");
      }
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true });
      current.stream = stream;
      if (current.controller.signal.aborted) { release(current); return; }
      const mimeType = ["audio/webm;codecs=opus", "audio/mp4", "audio/ogg;codecs=opus"].find(type => MediaRecorder.isTypeSupported(type));
      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined);
      current.recorder = recorder;
      const chunks: Blob[] = [];
      let bytes = 0;
      recorder.ondataavailable = event => {
        bytes += event.data.size;
        if (bytes > 10 * 1024 * 1024) {
          setError("Recording too large. Please try a shorter message.");
          cancel();
        } else if (event.data.size) chunks.push(event.data);
      };
      recorder.onerror = () => { setError("Recording failed. Please try again."); cancel(); };
      recorder.onstop = async () => {
        release(current);
        if (current.controller.signal.aborted) return;
        setState("transcribing");
        try {
          const response = await fetch("/api/voice/transcribe", {
            method: "POST", body: new Blob(chunks, { type: recorder.mimeType }), signal: current.controller.signal,
          });
          const result = await response.json();
          if (!response.ok) throw new Error(result.error ?? "Transcription failed. Try again.");
          if (typeof result.text !== "string" || !result.text.trim()) throw new Error("No speech heard. Try again.");
          if (!current.controller.signal.aborted) callback.current(result.text);
        } catch (error) {
          if (!current.controller.signal.aborted) setError(error instanceof Error ? error.message : "Transcription failed. Try again.");
        } finally {
          if (session.current === current) { session.current = null; setState("idle"); }
        }
      };
      recorder.start(1000);
      setState("recording");
      // Stop and transcribe after two minutes to cap uploads and speech-to-text cost.
      current.timer = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 120000);
    } catch (error) {
      release(current);
      if (!current.controller.signal.aborted) {
        session.current = null;
        setState("idle");
        setError(error instanceof Error && error.name === "NotAllowedError"
          ? "Microphone access denied. Allow access and retry."
          : error instanceof Error ? error.message : "Could not start recording.");
      }
    }
  };

  const label = playback ? (playback.state === "speaking" ? "Sam is speaking · tap to stop" : "Loading Sam's voice · tap to cancel")
    : running ? "Sam is thinking · tap to stop"
    : state === "recording" ? "Listening · tap when you're done"
    : state === "transcribing" ? "Sending your voice to Sam…"
    : state === "starting" ? "Opening microphone…" : "Tap Sam and ask out loud";
  const action = playback ? "Stop audio" : running ? "Stop Sam" : state === "recording" ? "Stop recording and ask Sam"
    : state !== "idle" ? "Cancel voice input" : "Ask Sam by voice";
  const energy = playback?.state === "speaking" ? 1 : state === "recording" ? 0.85 : running ? 0.65 : state !== "idle" || playback ? 0.45 : 0.16;
  const hero = variant === "hero";

  return <div className={cn("flex items-center gap-3", hero ? "flex-col text-center" : "mb-2 px-1")}>
    <button type="button" disabled={disabled && state === "idle" && !playback && !running}
      onClick={() => playback ? stopPlayback() : running ? onStop() : state === "recording" ? session.current?.recorder?.stop() : state !== "idle" ? cancel() : void start()}
      aria-label={action} title={label}
      className={cn(
        "flex-none rounded-full outline-none transition-[background-color,opacity,transform] hover:bg-accent/5 active:scale-[0.98] focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40",
        hero && "rounded-[3rem]",
      )}>
      <SamOrb energy={energy} points={hero ? 760 : 520} className={hero ? "h-52 w-52 sm:h-64 sm:w-64" : "h-24 w-24"} />
    </button>
    <div className={cn("flex flex-col gap-1", hero && "items-center")}>
      <span role="status" className={cn("text-muted", hero ? "text-[15px]" : "text-xs")}>{label}</span>
      {error && <span role="alert" className="text-xs text-danger">{error} <button type="button" onClick={() => setError(null)} aria-label="Dismiss voice error">×</button></span>}
      {playbackError && <span role="alert" className="text-xs text-danger">{playbackError}</span>}
    </div>
    {state === "recording" && <button type="button" onClick={cancel} aria-label="Cancel voice input" className="p-1 text-muted hover:text-foreground"><X size={16} /></button>}
  </div>;
}
