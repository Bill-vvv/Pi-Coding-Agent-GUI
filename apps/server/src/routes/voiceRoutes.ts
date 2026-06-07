import type { VoiceInputStatus, VoiceRecordingStartResponse, VoiceTranscriptionResponse } from "@pi-gui/shared";
import type { FastifyInstance, FastifyReply } from "fastify";
import { isVoiceInputError, VoiceInputError, type VoiceTranscriptionService } from "../services/voiceInput/index.js";

type VoiceRouteService = Pick<VoiceTranscriptionService, "getStatus" | "transcribe" | "startRecording" | "stopRecording">;
type VoiceTranscriptionErrorResponse = { error: string; code?: string };

const MAX_VOICE_ROUTE_BYTES = 100 * 1024 * 1024;

export async function registerVoiceRoutes(fastify: FastifyInstance, service: VoiceRouteService): Promise<void> {
  registerAudioParser(fastify);

  fastify.get("/api/voice/status", async (): Promise<VoiceInputStatus> => service.getStatus());

  fastify.post("/api/voice/transcribe", { bodyLimit: MAX_VOICE_ROUTE_BYTES }, async (request, reply): Promise<VoiceTranscriptionResponse | VoiceTranscriptionErrorResponse> => {
    return voiceRouteReply(reply, async () => {
      if (!Buffer.isBuffer(request.body)) throw new VoiceInputError("Expected audio request body", 400, "invalid_audio");
      const mimeType = voiceMimeType(request.headers["content-type"], request.headers["x-voice-mime-type"]);
      return service.transcribe(request.body, mimeType);
    });
  });

  fastify.post("/api/voice/recording/start", async (_request, reply): Promise<VoiceRecordingStartResponse | VoiceTranscriptionErrorResponse> => {
    return voiceRouteReply(reply, () => service.startRecording());
  });

  fastify.post("/api/voice/recording/stop", async (_request, reply): Promise<VoiceTranscriptionResponse | VoiceTranscriptionErrorResponse> => {
    return voiceRouteReply(reply, () => service.stopRecording());
  });
}

function registerAudioParser(fastify: FastifyInstance): void {
  const parseBuffer: Parameters<FastifyInstance["addContentTypeParser"]>[2] = (_request, body, done) => {
    done(null, body);
  };
  addBufferParserIfMissing(fastify, /^audio\//, parseBuffer);
  addBufferParserIfMissing(fastify, "application/octet-stream", parseBuffer);
}

function addBufferParserIfMissing(
  fastify: FastifyInstance,
  contentType: string | RegExp,
  parser: Parameters<FastifyInstance["addContentTypeParser"]>[2],
): void {
  if (fastify.hasContentTypeParser(contentType)) return;
  fastify.addContentTypeParser(contentType, { parseAs: "buffer", bodyLimit: MAX_VOICE_ROUTE_BYTES }, parser);
}

function voiceMimeType(contentType: unknown, override: unknown): string {
  const value = typeof override === "string" && override.trim() ? override : typeof contentType === "string" ? contentType : "application/octet-stream";
  return value.split(";")[0]?.trim() || "application/octet-stream";
}

async function voiceRouteReply<T>(reply: FastifyReply, action: () => Promise<T>): Promise<T | VoiceTranscriptionErrorResponse> {
  try {
    return await action();
  } catch (error) {
    const routeError = voiceRouteError(error);
    reply.code(routeError.statusCode);
    return { error: routeError.message, code: routeError.code };
  }
}

function voiceRouteError(error: unknown): { statusCode: number; message: string; code?: string } {
  if (isVoiceInputError(error)) return { statusCode: error.statusCode, message: error.message, code: error.code };
  return { statusCode: 500, message: error instanceof Error ? error.message : String(error) };
}
