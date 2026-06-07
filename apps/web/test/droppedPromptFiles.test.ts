import assert from "node:assert/strict";
import test from "node:test";
import type { ImportedFileResponse } from "@pi-gui/shared";
import {
  buildDroppedPromptFragment,
  fileUriToPath,
  formatFileReference,
  mergePromptFragment,
  parsePlainTextPaths,
  parseUriListPaths,
  serverReadableReferencePath,
} from "../src/domain/droppedPromptFiles";

test("buildDroppedPromptFragment reuses Linux file URI paths without upload", async () => {
  const uploads: string[] = [];
  const result = await buildDroppedPromptFragment([file("README.md")], ["/home/me/project/README.md"], [], async (droppedFile) => {
    uploads.push(droppedFile.name);
    return imported("/tmp/uploaded/README.md");
  });

  assert.equal(result.fragment, "@/home/me/project/README.md");
  assert.equal(uploads.length, 0);
  assert.match(result.notice, /已添加 1 个文件引用/);
});

test("buildDroppedPromptFragment uploads dropped files when paths are Windows-only", async () => {
  const result = await buildDroppedPromptFragment([file("notes.txt")], ["C:/Users/me/notes.txt"], [], async () => imported("/tmp/pi-gui-imports/notes.txt"));

  assert.equal(result.fragment, "@/tmp/pi-gui-imports/notes.txt");
});

test("buildDroppedPromptFragment reports unsupported path-only drops instead of inserting unreadable references", async () => {
  const result = await buildDroppedPromptFragment([], ["C:/Users/me/notes.txt", "\\\\wsl.localhost\\Ubuntu\\home\\me\\ok.txt", "/home/me/readme.md"]);

  assert.equal(result.fragment, "@/home/me/ok.txt\n@/home/me/readme.md");
  assert.match(result.notice, /暂不支持 1 个/);
});

test("file path parsing and formatting covers uri lists, WSL paths, and spaces", () => {
  assert.deepEqual(parseUriListPaths("# comment\nfile:///home/me/a%20b.txt\nhttps://example.test/nope"), ["/home/me/a b.txt"]);
  assert.equal(fileUriToPath("file:///C:/Users/me/a.txt"), "C:/Users/me/a.txt");
  assert.equal(fileUriToPath("file://wsl.localhost/Ubuntu/home/me/a.txt"), "/home/me/a.txt");
  assert.deepEqual(parsePlainTextPaths("relative\n~/todo.md\nC:\\Users\\me\\todo.md\n\\\\wsl$\\Ubuntu\\home\\me\\todo.md"), ["~/todo.md", "C:\\Users\\me\\todo.md", "\\\\wsl$\\Ubuntu\\home\\me\\todo.md"]);
  assert.equal(formatFileReference("/home/me/a b.txt"), '@"/home/me/a b.txt"');
});

test("serverReadableReferencePath accepts backend-readable paths only", () => {
  assert.equal(serverReadableReferencePath("/home/me/file.txt"), "/home/me/file.txt");
  assert.equal(serverReadableReferencePath("~/file.txt"), "~/file.txt");
  assert.equal(serverReadableReferencePath("C:/Users/me/file.txt"), undefined);
  assert.equal(serverReadableReferencePath("/C:/Users/me/file.txt"), undefined);
  assert.equal(serverReadableReferencePath("\\\\wsl.localhost\\Ubuntu\\home\\me\\file.txt"), "/home/me/file.txt");
});

test("mergePromptFragment preserves surrounding prompt text and cursor position", () => {
  const merged = mergePromptFragment("before after", 7, 7, "@/tmp/file.txt");

  assert.equal(merged.text, "before \n\n@/tmp/file.txt\n\nafter");
  assert.equal(merged.cursor, "before \n\n@/tmp/file.txt\n\n".length);
});

function file(name: string): File {
  return new File(["content"], name, { type: "text/plain" });
}

function imported(path: string): ImportedFileResponse {
  return { path, name: path.split("/").at(-1) ?? "file", size: 7 };
}
