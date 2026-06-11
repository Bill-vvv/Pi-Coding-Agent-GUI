import assert from "node:assert/strict";
import test from "node:test";
import { redactLogUrl } from "../src/rendererDiagnostics.js";

test("redactLogUrl removes desktop auth tokens from diagnostic URLs", () => {
  assert.equal(redactLogUrl("http://127.0.0.1:5173/?token=secret&x=1"), "http://127.0.0.1:5173/?token=[redacted]&x=1");
  assert.equal(redactLogUrl("http://127.0.0.1:5173/?authToken=secret"), "http://127.0.0.1:5173/?authToken=[redacted]");
  assert.equal(redactLogUrl("http://127.0.0.1:5173/?access_token=secret#hash"), "http://127.0.0.1:5173/?access_token=[redacted]");
});
