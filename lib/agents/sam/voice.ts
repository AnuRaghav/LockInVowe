import { ElevenLabsClient } from "@elevenlabs/elevenlabs-js";

import { getSamVoiceConfig } from "@/lib/agents/sam/config";

/**
 * Optional voice adapter.
 *
 * Speech is a presentation concern, so it sits outside the agent loop: the
 * agent produces text, and a caller may pass that text here. When ElevenLabs
 * credentials are absent this returns `null` so voice stays opt-in.
 */
export const speak = async (
  text: string,
  signal?: AbortSignal,
): Promise<ReadableStream<Uint8Array> | null> => {
  const config = getSamVoiceConfig();
  if (!config) return null;

  const client = new ElevenLabsClient({ apiKey: config.apiKey });

  return client.textToSpeech.stream(config.voiceId, {
    text,
    modelId: config.modelId,
    outputFormat: "mp3_44100_128",
  }, { abortSignal: signal, maxRetries: 0, timeoutInSeconds: 60 });
};

/** Batch transcription uses Scribe, not the configured TTS model. No audio is stored by Sam. */
export const transcribe = async (file: File, signal?: AbortSignal): Promise<string | null> => {
  const config = getSamVoiceConfig();
  if (!config) return null;
  const client = new ElevenLabsClient({ apiKey: config.apiKey });
  const result = await client.speechToText.convert({
    file, modelId: "scribe_v2", tagAudioEvents: false, diarize: false,
  }, { abortSignal: signal, maxRetries: 0, timeoutInSeconds: 60 });
  if (!("text" in result) || typeof result.text !== "string") throw new Error("Missing transcript");
  return result.text.trim();
};

/** Whether voice output is configured for this environment. */
export const isVoiceEnabled = (): boolean => getSamVoiceConfig() !== null;
