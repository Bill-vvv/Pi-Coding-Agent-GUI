import assert from "node:assert/strict";
import test from "node:test";
import { LfJsonlParser } from "../src/runtime/jsonlFraming.js";

test("LfJsonlParser parses LF-delimited records across chunks", () => {
  const parser = new LfJsonlParser();

  assert.deepEqual(parser.push('{"type":"one"').records, []);
  const batch = parser.push('}\n{"type":"two"}\n');

  assert.deepEqual(batch.errors, []);
  assert.deepEqual(batch.records, [{ type: "one" }, { type: "two" }]);
});

test("LfJsonlParser tolerates CRLF by trimming a trailing CR", () => {
  const parser = new LfJsonlParser();
  const batch = parser.push('{"ok":true}\r\n');

  assert.deepEqual(batch.errors, []);
  assert.deepEqual(batch.records, [{ ok: true }]);
});

test("LfJsonlParser does not split on Unicode line separators", () => {
  const parser = new LfJsonlParser();

  assert.deepEqual(parser.push('{"first":true}\u2028').records, []);
  const batch = parser.push('{"second":true}\n');

  assert.equal(batch.records.length, 0);
  assert.equal(batch.errors.length, 1);
  assert.match(batch.errors[0]?.message ?? "", /Failed to parse Pi RPC JSONL record/);
});

test("LfJsonlParser reports invalid records but continues after the next LF", () => {
  const parser = new LfJsonlParser();
  const batch = parser.push('not-json\n{"ok":true}\n');

  assert.equal(batch.errors.length, 1);
  assert.deepEqual(batch.records, [{ ok: true }]);
});

test("LfJsonlParser reports an unterminated record on end", () => {
  const parser = new LfJsonlParser();
  parser.push('{"partial":');

  const batch = parser.end();

  assert.deepEqual(batch.records, []);
  assert.equal(batch.errors.length, 1);
  assert.match(batch.errors[0]?.message ?? "", /unterminated JSONL record/);
});
