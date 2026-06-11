import assert from "node:assert/strict";
import test from "node:test";
import { buildStreamingMarkdownModel } from "../src/domain/markdownStreaming";

test("streaming markdown model keeps closed code blocks stable when tail grows", () => {
  const initial = buildStreamingMarkdownModel("前言\n\n```ts\nconst a = 1;\n```\n\n结尾");
  const appended = buildStreamingMarkdownModel("前言\n\n```ts\nconst a = 1;\n```\n\n结尾继续");

  assert.equal(initial.blocks.length, 3);
  assert.equal(initial.blocks[0]?.kind, "markdown");
  assert.equal(initial.blocks[1]?.kind, "code_fence");
  assert.equal(initial.blocks[2]?.kind, "markdown");
  assert.equal(initial.blocks[1]?.stable, true);
  assert.equal((initial.blocks[1] && initial.blocks[1].kind === "code_fence") ? initial.blocks[1].closed : false, true);
  assert.equal(initial.blocks[0]?.id, appended.blocks[0]?.id);
  assert.equal(initial.blocks[1]?.id, appended.blocks[1]?.id);
  assert.equal(appended.blocks[2]?.id, initial.blocks[2]?.id);
});

test("streaming markdown model keeps an open fenced block as the active tail", () => {
  const model = buildStreamingMarkdownModel("说明\n\n```ts\nconst value = 1;");
  assert.equal(model.blocks.length, 2);
  assert.equal(model.blocks[0]?.kind, "markdown");
  assert.equal(model.blocks[0]?.stable, true);
  assert.equal(model.blocks[1]?.kind, "code_fence");
  assert.equal(model.blocks[1]?.stable, false);
  assert.equal((model.blocks[1] && model.blocks[1].kind === "code_fence") ? model.blocks[1].closed : true, false);
  assert.match((model.blocks[1] && model.blocks[1].kind === "code_fence") ? model.blocks[1].code : "", /const value = 1/);
});

test("streaming markdown model keeps earlier paragraph blocks stable when plain tail text grows", () => {
  const initial = buildStreamingMarkdownModel("第一段\n\n第二段");
  const appended = buildStreamingMarkdownModel("第一段\n\n第二段继续");

  assert.equal(initial.blocks.length, 2);
  assert.equal(initial.blocks[0]?.kind, "markdown");
  assert.equal(initial.blocks[0]?.stable, true);
  assert.equal(initial.blocks[1]?.kind, "markdown");
  assert.equal(initial.blocks[1]?.stable, false);
  assert.equal(initial.blocks[0]?.id, appended.blocks[0]?.id);
  assert.equal(initial.blocks[1]?.id, appended.blocks[1]?.id);
  assert.match(initial.blocks[1]?.text ?? "", /第二段/);
  assert.match(appended.blocks[1]?.text ?? "", /第二段继续/);
});
