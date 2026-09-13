# Sam voice

Voice is presentation/input for the existing chat, not another agent or conversation type.

- Tap the Sam orb above the composer to record. Tap again to transcribe with ElevenLabs Scribe (`scribe_v2`). The transcript appends to the editable draft; nothing auto-sends.
- Submit normally. Sam continues using the existing chat route and durable text conversation.
- Use the small **Listen** action on a saved assistant answer to stream ElevenLabs speech. The orb shows playback and stops it when tapped.
- The orb labels idle, listening, transcribing, Sam working, and speaking states. While Sam is working, tapping it uses the existing stop action.
- Cancel discards pending dictation. Thread changes, sends, unmounts, and starting playback clean up recording/playback resources. Voice errors do not replace chat errors or erase the draft.

## Server

Reuses `lib/agents/sam/voice.ts` and `getSamVoiceConfig()` with `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, and `ELEVENLABS_MODEL_ID` (TTS only). No key is sent to the browser.

- `POST /api/voice/transcribe`: authenticated audio upload, at most 10 MiB, returns `{ text }`. Browser recording stops after two minutes. Requires HTTPS or localhost and a browser supporting MediaRecorder.
- `GET /api/voice/speech?threadId=…&messageId=…`: authenticates, loads the company-owned conversation, and streams MP3 for a saved assistant message (maximum 20,000 characters). It does not trust browser-supplied text. Responses are not cached.

Neither route writes audio, transcripts, or special voice records to application storage. Audio is sent to ElevenLabs for processing; provider retention follows the account's settings (this does not claim enterprise zero-retention).

## Verification

- Live browser dictation using a synthetic microphone source reached ElevenLabs and populated the composer with “What is our runway?” without auto-send.
- Manual submission reached the existing chat endpoint. Sam failed before generating a completed answer, including on a simple greeting, so a full real chat-to-TTS run could not be verified.
- Live ElevenLabs TTS generated playable MP3. Browser playback and orb speaking/stop/idle transitions were verified with a temporary in-browser message/audio fixture, not a fabricated persisted assistant answer. Temporary audio fixtures were removed.
- Six route tests cover canonical text/ownership, authentication, streaming, transcript return, upload validation, and safe provider errors. Typecheck, lint, build, and the test suite pass.

Deferred: realtime/full-duplex voice, automatic sending or automatic playback, persistent audio, and production usage quotas/rate limiting. Full live chat-to-playback verification remains blocked by the existing Sam runtime failure.
