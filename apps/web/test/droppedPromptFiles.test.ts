import assert from "node:assert/strict";
import test from "node:test";
import type { ImportedFileResponse } from "@pi-gui/shared";
import {
  buildDroppedPromptFragment,
  droppedReferencePaths,
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

test("buildDroppedPromptFragment uploads dropped files when file URI host is remote", async () => {
  const uploads: string[] = [];
  const result = await buildDroppedPromptFragment([file("share.txt")], parseUriListPaths("file://server/share/share.txt"), [], async (droppedFile) => {
    uploads.push(droppedFile.name);
    return imported("/tmp/pi-gui-imports/share.txt");
  });

  assert.deepEqual(uploads, ["share.txt"]);
  assert.equal(result.fragment, "@/tmp/pi-gui-imports/share.txt");
});

test("droppedReferencePaths preserves file URI slots so remote hosts do not shift local paths", async () => {
  const files = [file("remote.txt"), file("local.txt")];
  const referencePaths = droppedReferencePaths(mockDataTransfer(files, "file://server/share/remote.txt\nfile:///home/me/local.txt"));
  const uploads: string[] = [];

  const result = await buildDroppedPromptFragment(files, referencePaths, [], async (droppedFile) => {
    uploads.push(droppedFile.name);
    return imported(`/tmp/pi-gui-imports/${droppedFile.name}`);
  });

  assert.deepEqual(referencePaths, [undefined, "/home/me/local.txt"]);
  assert.deepEqual(uploads, ["remote.txt"]);
  assert.equal(result.fragment, "@/tmp/pi-gui-imports/remote.txt\n@/home/me/local.txt");
});

test("droppedReferencePaths falls back to plain text paths when uri-list has no readable path-only entries", () => {
  const referencePaths = droppedReferencePaths(mockDataTransfer([], "file://server/share/remote.txt", "/home/me/local.txt"));

  assert.deepEqual(referencePaths, ["/home/me/local.txt"]);
});

test("buildDroppedPromptFragment reports unsupported path-only drops instead of inserting unreadable references", async () => {
  const result = await buildDroppedPromptFragment([], ["C:/Users/me/notes.txt", "\\\\wsl.localhost\\Ubuntu\\home\\me\\ok.txt", "/home/me/readme.md"]);

  assert.equal(result.fragment, "@/home/me/ok.txt\n@/home/me/readme.md");
  assert.match(result.notice, /暂不支持 1 个/);
});

test("buildDroppedPromptFragment blocks large image batches before staging base64-prone context", async () => {
  const uploads: string[] = [];
  const files = Array.from({ length: 9 }, (_, index) => new File(["x"], `page-${index + 1}.png`, { type: "image/png" }));

  const result = await buildDroppedPromptFragment(files, [], [], async (droppedFile) => {
    uploads.push(droppedFile.name);
    return imported(`/tmp/pi-gui-imports/${droppedFile.name}`);
  });

  assert.equal(result.fragment, "");
  assert.equal(uploads.length, 0);
  assert.match(result.notice, /一次导入 9 张图片风险过高/);
  assert.match(result.notice, /降低分辨率|分批提交/);
});

test("buildDroppedPromptFragment preserves image-only path batches as editable references", async () => {
  const paths = Array.from({ length: 9 }, (_, index) => `/home/me/page-${index + 1}.jpg`);

  const result = await buildDroppedPromptFragment([], paths);

  assert.equal(result.fragment, paths.map((path) => `@${path}`).join("\n"));
  assert.match(result.notice, /已添加 9 个文件引用/);
});

test("buildDroppedPromptFragment does not block directly readable dropped image paths", async () => {
  const uploads: string[] = [];
  const files = Array.from({ length: 9 }, (_, index) => new File(["x"], `page-${index + 1}.png`, { type: "image/png" }));
  const paths = files.map((file) => `/home/me/${file.name}`);

  const result = await buildDroppedPromptFragment(files, paths, [], async (droppedFile) => {
    uploads.push(droppedFile.name);
    return imported(`/tmp/pi-gui-imports/${droppedFile.name}`);
  });

  assert.equal(result.fragment, paths.map((path) => `@${path}`).join("\n"));
  assert.equal(uploads.length, 0);
});

test("buildDroppedPromptFragment warns that PDFs are path references", async () => {
  const result = await buildDroppedPromptFragment([new File(["%PDF"], "scan.pdf", { type: "application/pdf" })], [], [], async () => imported("/tmp/pi-gui-imports/scan.pdf"));

  assert.equal(result.fragment, "@/tmp/pi-gui-imports/scan.pdf");
  assert.match(result.notice, /PDF 已作为路径引用导入/);
});

test("buildDroppedPromptFragment does not claim failed PDF imports were referenced", async () => {
  const result = await buildDroppedPromptFragment([new File(["%PDF"], "scan.pdf", { type: "application/pdf" })], [], [], async () => {
    throw new Error("upload failed");
  });

  assert.equal(result.fragment, "");
  assert.match(result.notice, /跳过 1 个/);
  assert.doesNotMatch(result.notice, /PDF 已作为路径引用导入/);
});

test("file path parsing and formatting covers uri lists, WSL paths, and spaces", () => {
  assert.deepEqual(parseUriListPaths("# comment\nfile:///home/me/a%20b.txt\nhttps://example.test/nope"), ["/home/me/a b.txt"]);
  assert.equal(fileUriToPath("file:///C:/Users/me/a.txt"), "C:/Users/me/a.txt");
  assert.equal(fileUriToPath("file://localhost/home/me/a.txt"), "/home/me/a.txt");
  assert.equal(fileUriToPath("file://server/share/a.txt"), undefined);
  assert.deepEqual(parseUriListPaths("file://server/share/a.txt"), []);
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

function mockDataTransfer(files: File[], uriList: string, plainText = ""): DataTransfer {
  return {
    files: { length: files.length },
    getData(type: string) {
      if (type === "text/uri-list") return uriList;
      if (type === "text/plain") return plainText;
      return "";
    },
  } as DataTransfer;
}
