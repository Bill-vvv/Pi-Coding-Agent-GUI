# Voice input service

This subdomain owns Pi GUI's local/offline voice transcription boundary.

Contracts:

- Browser capture mode:
  - Browser records microphone audio.
  - Frontend sends bytes to `POST /api/voice/transcribe`.
  - Backend calls wrapper `POST /transcribe` and returns `{ text, durationMs? }`.
- Native capture mode:
  - Browser does not call `getUserMedia`.
  - Frontend toggles `POST /api/voice/recording/start` and `POST /api/voice/recording/stop`.
  - Backend calls wrapper `POST /record/start` and `POST /record/stop`.
  - Wrapper records on the host where it runs and returns `{ text, durationMs? }` on stop.

Settings:

- `voiceInput.mode`: disabled, external service, or managed local process.
- `voiceInput.captureMode`: `browser` by default, or `native` for host-helper microphone capture.

The wrapper contract includes `GET /health`, `POST /transcribe`, `POST /record/start`, and `POST /record/stop`.

Users provide installed runtime/model paths; Pi GUI does not download models.
Audio and full transcripts must not be logged or persisted.

Managed process mode starts a user-configured command and then calls the same local service URL. It must use `spawn(command, args)` rather than shell strings.
