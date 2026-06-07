export type VoiceInputErrorCode =
  | "voice_input_disabled"
  | "voice_input_not_configured"
  | "invalid_audio"
  | "audio_too_large"
  | "empty_transcript"
  | "managed_process_error"
  | "upstream_unavailable"
  | "upstream_timeout"
  | "upstream_error"
  | "invalid_upstream_response"
  | "native_recording_unsupported"
  | "native_recording_already_active"
  | "native_recording_not_active"
  | "native_recording_error";

export class VoiceInputError extends Error {
  constructor(
    message: string,
    public readonly statusCode: number,
    public readonly code: VoiceInputErrorCode,
  ) {
    super(message);
    this.name = "VoiceInputError";
  }
}

export function isVoiceInputError(error: unknown): error is VoiceInputError {
  return error instanceof VoiceInputError;
}
