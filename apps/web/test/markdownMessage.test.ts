import assert from "node:assert/strict";
import test from "node:test";
import { createElement } from "react";
import { renderToStaticMarkup } from "react-dom/server";
import { MarkdownMessage } from "../src/components/MarkdownMessage";
import { clearMarkdownEmergencyFallbackEvents, readMarkdownEmergencyFallbackEvents } from "../src/domain/markdownRenderDiagnostics";

test("streaming markdown with fenced code stays on the normal render path", () => {
  const html = renderToStaticMarkup(createElement(MarkdownMessage, {
    text: "前言\n\n```ts\nconst value = 1;\n```\n\n继续输出",
    streaming: true,
    source: "message",
  }));

  assert.doesNotMatch(html, /large-markdown-preview/);
  assert.match(html, /const value = 1;/);
  assert.match(html, /markdown-code-block/);
});

test("emergency fallback requires an explicit fault/debug trigger", () => {
  clearMarkdownEmergencyFallbackEvents();
  const originalWarn = console.warn;
  console.warn = () => undefined;
  (globalThis as { __PI_GUI_FORCE_MARKDOWN_EMERGENCY_FALLBACK__?: unknown }).__PI_GUI_FORCE_MARKDOWN_EMERGENCY_FALLBACK__ = "test-force";
  try {
    const html = renderToStaticMarkup(createElement(MarkdownMessage, {
      text: "强制 fallback",
      streaming: true,
      source: "subagent",
    }));

    assert.match(html, /large-markdown-preview/);
    assert.match(html, /紧急保护模式/);
    const events = readMarkdownEmergencyFallbackEvents();
    assert.equal(events.at(-1)?.reason, "test-force");
    assert.equal(events.at(-1)?.source, "subagent");
  } finally {
    console.warn = originalWarn;
    delete (globalThis as { __PI_GUI_FORCE_MARKDOWN_EMERGENCY_FALLBACK__?: unknown }).__PI_GUI_FORCE_MARKDOWN_EMERGENCY_FALLBACK__;
    clearMarkdownEmergencyFallbackEvents();
  }
});

test("streaming open code fences show raw code immediately", () => {
  const html = renderToStaticMarkup(createElement(MarkdownMessage, {
    text: "```ts\nconsole.log('ready')",
    streaming: true,
    source: "thinking",
  }));

  assert.match(html, /console\.log/);
  assert.doesNotMatch(html, /完整渲染/);
  assert.doesNotMatch(html, /轻量渲染/);
});
