import assert from "node:assert/strict";
import test from "node:test";
import { inspectPiSessionContent } from "../src/services/piSessionHealth.js";

test("inspectPiSessionContent flags large sessions with embedded image payloads", () => {
  const imageData = "a".repeat(120_000);
  const content = `${JSON.stringify({ type: "message", message: { role: "toolResult", content: [{ type: "image", data: imageData }] } })}\n`;

  const issue = inspectPiSessionContent("/tmp/session.jsonl", content, 20 * 1024 * 1024);

  assert.equal(issue?.code, "embedded_image_context_too_large");
  assert.equal(issue?.embeddedImageParts, 1);
  assert.match(issue?.message ?? "", /too large to resume safely/);
  assert.match(issue?.message ?? "", /WebSocket 1009/);
  assert.match(issue?.message ?? "", /sanitize-pi-session/);
});

test("inspectPiSessionContent does not flag ordinary large text-only sessions", () => {
  const content = `${JSON.stringify({ type: "message", message: { role: "assistant", content: "ordinary text" } })}\n`;

  assert.equal(inspectPiSessionContent("/tmp/session.jsonl", content, 20 * 1024 * 1024), undefined);
});
