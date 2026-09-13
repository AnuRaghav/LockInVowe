"use client";

import { useEffect, useRef, useState } from "react";
import { X } from "@phosphor-icons/react";
import { SamOrb } from "@/components/SamOrb";
import { useVoicePlayback } from "@/components/chat/VoicePlayback";

type Session = { controller: AbortController; stream?: MediaStream; recorder?: MediaRecorder; timer?: ReturnType<typeof setTimeout> };

export function VoiceInput({ disabled, running, onStop, onTranscript }: {
  disabled: boolean; running: boolean; onStop: () => void; onTranscript: (text: string) => void;
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
        throw new Error("Recording is not supported here. Use a supported browser over HTTPS, or type instead.");
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
      recorder.onerror = () => { setError("Recording failed. Please try again or type instead."); cancel(); };
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
      // Short dictation only; stop and transcribe after two minutes.
      current.timer = setTimeout(() => { if (recorder.state === "recording") recorder.stop(); }, 120000);
    } catch (error) {
      release(current);
      if (!current.controller.signal.aborted) {
        session.current = null;
        setState("idle");
        setError(error instanceof Error && error.name === "NotAllowedError"
          ? "Microphone access denied. Allow access and retry, or type instead."
          : error instanceof Error ? error.message : "Could not start recording.");
      }
    }
  };

  const label = playback ? (playback.state === "speaking" ? "Speaking · tap to stop" : "Loading audio · tap to cancel")
    : running ? "Sam is working · tap to stop"
    : state === "recording" ? "Listening · tap to transcribe"
    : state === "transcribing" ? "Transcribing · tap to cancel"
    : state === "starting" ? "Opening microphone · tap to cancel" : "Tap Sam to speak";
  const action = playback ? "Stop audio" : running ? "Stop Sam" : state === "recording" ? "Stop recording and transcribe"
    : state !== "idle" ? "Cancel voice input" : "Record voice message";
  const energy = playback?.state === "speaking" ? 1 : state === "recording" ? 0.8 : running ? 0.6 : state !== "idle" || playback ? 0.4 : 0.1;

  return <div className="mb-2 flex items-center gap-2 px-1">
    <button type="button" disabled={disabled && state === "idle" && !playback && !running}
      onClick={() => playback ? stopPlayback() : running ? onStop() : state === "recording" ? session.current?.recorder?.stop() : state !== "idle" ? cancel() : void start()}
      aria-label={action} title={label}
      className="flex-none rounded-full outline-none transition-colors hover:bg-accent/5 focus-visible:ring-2 focus-visible:ring-accent disabled:opacity-40">
      <SamOrb energy={energy} points={360} className="h-16 w-16" />
    </button>
    <div className="flex flex-col gap-1">
      <span role="status" className="text-xs text-muted">{label}</span>
      {error && <span role="alert" className="text-xs text-danger">{error} <button type="button" onClick={() => setError(null)} aria-label="Dismiss voice error">×</button></span>}
      {playbackError && <span role="alert" className="text-xs text-danger">{playbackError}</span>}
    </div>
    {state === "recording" && <button type="button" onClick={cancel} aria-label="Cancel voice input" className="p-1 text-muted hover:text-foreground"><X size={16} /></button>}
  </div>;
}
