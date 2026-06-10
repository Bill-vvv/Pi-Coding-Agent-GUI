#!/usr/bin/env node
import { copyFileSync, readFileSync, renameSync, statSync, writeFileSync } from "node:fs";
import { basename } from "node:path";

const args = process.argv.slice(2);
const apply = args.includes("--apply");
const help = args.includes("--help") || args.includes("-h");
const sessionFile = args.find((arg) => !arg.startsWith("-"));

if (help || !sessionFile) {
  console.log(`Usage: node scripts/sanitize-pi-session.mjs [--apply] <pi-session.jsonl>\n\nRemoves embedded image/base64 payloads and truncates huge/binary tool outputs from a Pi session JSONL file.\nDefault is dry-run. Use --apply to write changes. A .bak-<timestamp> backup is created before writing.`);
  process.exit(help ? 0 : 1);
}

const MAX_TEXT = 12_000;
const MAX_DATA = 200;
const beforeBytes = statSync(sessionFile).size;
const input = readFileSync(sessionFile, "utf8");
const stats = { lines: 0, imageParts: 0, truncatedStrings: 0 };

function sanitize(value, key) {
  if (Array.isArray(value)) return value.map((item) => sanitize(item, key));
  if (value && typeof value === "object") {
    if (value.type === "image" && typeof value.data === "string") {
      stats.imageParts += 1;
      return { ...value, data: `[sanitized: omitted ${value.data.length} chars of embedded image data]` };
    }
    return Object.fromEntries(Object.entries(value).map(([childKey, childValue]) => [childKey, sanitize(childValue, childKey)]));
  }
  if (typeof value !== "string") return value;

  if ((key === "data" || key === "image" || key === "base64") && value.length > MAX_DATA) {
    stats.truncatedStrings += 1;
    return `[sanitized: omitted ${value.length} chars of embedded image/base64 data]`;
  }
  if (value.length > MAX_TEXT || printableRatio(value) < 0.85) {
    stats.truncatedStrings += 1;
    const head = value.slice(0, 4000);
    const tail = value.length > 5000 ? value.slice(-1000) : "";
    const omitted = Math.max(0, value.length - head.length - tail.length);
    return `${head}\n\n[sanitized: omitted ${omitted} chars of large/binary tool output]\n\n${tail}`;
  }
  return value;
}

function printableRatio(value) {
  const sample = value.slice(0, 5000);
  if (!sample) return 1;
  let printable = 0;
  for (const char of sample) {
    const code = char.charCodeAt(0);
    if (char === "\n" || char === "\r" || char === "\t" || (code >= 32 && code <= 0xd7ff)) printable += 1;
  }
  return printable / sample.length;
}

const outputLines = [];
for (const line of input.split("\n")) {
  if (!line) continue;
  stats.lines += 1;
  try {
    outputLines.push(JSON.stringify(sanitize(JSON.parse(line)), null, 0));
  } catch {
    outputLines.push(sanitize(line));
  }
}
const output = `${outputLines.join("\n")}\n`;
const afterBytes = Buffer.byteLength(output);
const summary = {
  file: sessionFile,
  before: formatBytes(beforeBytes),
  after: formatBytes(afterBytes),
  lines: stats.lines,
  imagePartsSanitized: stats.imageParts,
  stringsTruncated: stats.truncatedStrings,
};
console.log(JSON.stringify(summary, null, 2));

if (!apply) {
  console.log("Dry-run only. Re-run with --apply to write changes.");
  process.exit(0);
}

const backup = `${sessionFile}.bak-${timestamp()}`;
copyFileSync(sessionFile, backup);
const tmp = `${sessionFile}.tmp-${process.pid}`;
writeFileSync(tmp, output, "utf8");
renameSync(tmp, sessionFile);
console.log(`Wrote sanitized session. Backup: ${backup}`);

function formatBytes(bytes) {
  if (bytes >= 1024 * 1024) return `${(bytes / 1024 / 1024).toFixed(1)} MB`;
  if (bytes >= 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${Math.floor(bytes)} B`;
}

function timestamp() {
  return new Date().toISOString().replace(/[-:]/g, "").replace(/\.\d{3}Z$/, "Z");
}
