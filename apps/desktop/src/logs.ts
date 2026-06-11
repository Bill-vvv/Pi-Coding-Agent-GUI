import { createWriteStream, mkdirSync, type WriteStream } from "node:fs";
import { join } from "node:path";

export type DesktopLogStreams = {
  backendLogPath: string;
  backendLog: WriteStream;
  close: () => Promise<void>;
};

export function createDesktopLogStreams(logDir: string): DesktopLogStreams {
  mkdirSync(logDir, { recursive: true });
  const backendLogPath = join(logDir, "backend.log");
  const backendLog = createWriteStream(backendLogPath, { flags: "a" });
  backendLog.write(`\n--- Pi GUI desktop backend ${new Date().toISOString()} ---\n`);
  return {
    backendLogPath,
    backendLog,
    close: () => closeStream(backendLog),
  };
}

export function appendProcessChunk(stream: WriteStream, source: "stdout" | "stderr", chunk: Buffer): void {
  const prefix = source === "stdout" ? "[stdout]" : "[stderr]";
  const text = chunk.toString("utf8");
  for (const line of text.split(/(?<=\n)/)) {
    if (!line) continue;
    stream.write(`${prefix} ${line}`);
  }
}

function closeStream(stream: WriteStream): Promise<void> {
  return new Promise((resolve) => {
    stream.end(resolve);
  });
}
