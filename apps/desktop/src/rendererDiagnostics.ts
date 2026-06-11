import type { BrowserWindow } from "electron";

export type RendererDiagnosticLogWriter = (message: string) => void;

export function wireRendererDiagnostics(window: BrowserWindow, writeLog: RendererDiagnosticLogWriter): void {
  window.webContents.on("console-message", (_event, level, message, line, sourceId) => {
    if (level < 2 && !/\b(error|exception|uncaught|failed)\b/i.test(message)) return;
    writeLog(`console level=${level} source=${redactLogUrl(sourceId)}:${line} ${message}`);
  });
  window.webContents.on("render-process-gone", (_event, details) => {
    writeLog(`render-process-gone ${JSON.stringify(details)}`);
  });
  window.webContents.on("unresponsive", () => {
    writeLog("window became unresponsive");
  });
  window.webContents.on("responsive", () => {
    writeLog("window became responsive");
  });
  window.webContents.on("did-fail-load", (_event, errorCode, errorDescription, validatedURL, isMainFrame) => {
    writeLog(`did-fail-load mainFrame=${isMainFrame} code=${errorCode} description=${errorDescription} url=${redactLogUrl(validatedURL)}`);
  });
}

export function redactLogUrl(value: string): string {
  return value.replace(/([?&](?:token|authToken|access_token)=)[^&]*/gi, "$1[redacted]");
}
