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
  text: string
): Promise<ReadableStream<Uint8Array> | null> => {
  const config = getSamVoiceConfig();
  if (!config) return null;

  const client = new ElevenLabsClient({ apiKey: config.apiKey });

  return client.textToSpeech.convert(config.voiceId, {
    text,
    modelId: config.modelId,
  });
};

/** Whether voice output is configured for this environment. */
export const isVoiceEnabled = (): boolean => getSamVoiceConfig() !== null;
