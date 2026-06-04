import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { expandPromptFileReferences } from "../src/runtime/promptFileReferences.js";

test("expandPromptFileReferences keeps text file references out of prompt context", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-prompt-files-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "note.txt"), "hello\nworld", "utf8");

  const expanded = await expandPromptFileReferences("Summarize @note.txt please", cwd);

  assert.deepEqual(expanded, { message: "Summarize @note.txt please" });
});

test("expandPromptFileReferences keeps large text references out of prompt context", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-prompt-files-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "large.txt"), `${"x".repeat(70 * 1024)}needle`, "utf8");

  const expanded = await expandPromptFileReferences("Search @large.txt", cwd);

  assert.deepEqual(expanded, { message: "Search @large.txt" });
});

test("expandPromptFileReferences preserves quoted text references with spaces", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-prompt-files-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  await writeFile(join(cwd, "with space.md"), "quoted content", "utf8");

  const expanded = await expandPromptFileReferences('Use @"with space.md"', cwd);

  assert.deepEqual(expanded, { message: 'Use @"with space.md"' });
});

test("expandPromptFileReferences attaches supported images without rewriting prompt text", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-prompt-files-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  const png = minimalPngBuffer();
  await writeFile(join(cwd, "image.png"), png);

  const expanded = await expandPromptFileReferences("Describe @image.png", cwd);

  assert.equal(expanded.message, "Describe @image.png");
  assert.equal(expanded.images?.length, 1);
  assert.equal(expanded.images?.[0]?.type, "image");
  assert.equal(expanded.images?.[0]?.mimeType, "image/png");
  assert.equal(expanded.images?.[0]?.data, png.toString("base64"));
});

test("expandPromptFileReferences leaves non-file mentions and slash commands unchanged", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-prompt-files-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  assert.deepEqual(await expandPromptFileReferences("email me at a@example.com and mention @nobody", cwd), {
    message: "email me at a@example.com and mention @nobody",
  });
  assert.deepEqual(await expandPromptFileReferences("/skill:test @missing.txt", cwd), {
    message: "/skill:test @missing.txt",
  });
});

function minimalPngBuffer(): Buffer {
  return Buffer.concat([
    Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]),
    Buffer.from([0x00, 0x00, 0x00, 0x0d]),
    Buffer.from("IHDR", "ascii"),
    Buffer.alloc(13),
    Buffer.alloc(4),
    Buffer.from([0x00, 0x00, 0x00, 0x00]),
    Buffer.from("IDAT", "ascii"),
  ]);
}
