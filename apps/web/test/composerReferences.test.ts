import assert from "node:assert/strict";
import test from "node:test";
import { activeComposerReferenceToken, completeComposerReference } from "../src/domain/composerReferences";

test("activeComposerReferenceToken finds @ token at caret", () => {
  assert.deepEqual(activeComposerReferenceToken("read @src/App", "read @src/App".length), { start: 5, end: 13, query: "src/App" });
  assert.equal(activeComposerReferenceToken("read @src App", "read @src App".length), undefined);
  assert.deepEqual(activeComposerReferenceToken('read @"src/App', 'read @"src/App'.length), { start: 5, end: 14, query: "src/App" });
});

test("completeComposerReference replaces active token with formatted reference", () => {
  const prompt = "read @src";
  const active = activeComposerReferenceToken(prompt, prompt.length);
  assert.ok(active);
  assert.deepEqual(completeComposerReference(prompt, active, { name: "App.tsx", path: "/repo/src/App.tsx", relativePath: "src/App.tsx", type: "file" }), {
    text: "read @src/App.tsx",
    cursor: "read @src/App.tsx".length,
  });
});
