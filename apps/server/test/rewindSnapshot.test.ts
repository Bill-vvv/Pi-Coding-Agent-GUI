import assert from "node:assert/strict";
import { mkdir, mkdtemp, readFile, readdir, readlink, rm, stat, symlink, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { RewindSnapshotStore } from "../src/services/rewind/index.js";

async function createWorkspace(prefix = "pi-gui-rewind-") {
  const root = await mkdtemp(join(tmpdir(), prefix));
  return root;
}

test("rewind snapshots dedupe unchanged content-addressed blobs", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, "a.txt"), "alpha", "utf8");
  await writeFile(join(root, "b.txt"), "bravo", "utf8");
  const store = new RewindSnapshotStore({ root });

  const first = await store.captureWorkspace("first");
  const objectCountAfterFirst = await countObjects(root);
  const second = await store.captureWorkspace("second");
  const objectCountAfterSecond = await countObjects(root);

  assert.equal(first.summary.capturedFiles, 2);
  assert.equal(first.summary.newBytes, "alpha".length + "bravo".length);
  assert.equal(second.summary.newBytes, 0);
  assert.equal(objectCountAfterSecond, objectCountAfterFirst);

  await writeFile(join(root, "a.txt"), "alpha changed", "utf8");
  const third = await store.captureWorkspace("third");
  assert.equal(third.summary.newBytes, "alpha changed".length);
  assert.equal(await countObjects(root), objectCountAfterFirst + 1);
});

test("rewind capture records default exclusions, secrets, and size caps as skips", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(join(root, "src"), { recursive: true });
  await mkdir(join(root, "node_modules", "pkg"), { recursive: true });
  await mkdir(join(root, ".git"), { recursive: true });
  await mkdir(join(root, ".pi", "rewind", "internal"), { recursive: true });
  await writeFile(join(root, "src", "index.ts"), "export {};", "utf8");
  await writeFile(join(root, "node_modules", "pkg", "index.js"), "module.exports = {};", "utf8");
  await writeFile(join(root, ".git", "config"), "[core]", "utf8");
  await writeFile(join(root, ".pi", "rewind", "internal", "blob"), "ignore", "utf8");
  await writeFile(join(root, ".env"), "TOKEN=secret", "utf8");
  await writeFile(join(root, "large.bin"), "this file is too large for the test policy", "utf8");

  const store = new RewindSnapshotStore({ root, policy: { maxFileBytes: 16 } });
  const snapshot = await store.captureWorkspace("policy");

  assert.deepEqual(snapshot.entries.map((entry) => entry.relativePath), ["src/index.ts"]);
  assert.ok(snapshot.skipped.some((entry) => entry.relativePath === "node_modules" && entry.reason === "excluded"));
  assert.ok(snapshot.skipped.some((entry) => entry.relativePath === ".git" && entry.reason === "excluded"));
  assert.ok(snapshot.skipped.some((entry) => entry.relativePath === ".pi/rewind" && entry.reason === "excluded"));
  assert.ok(snapshot.skipped.some((entry) => entry.relativePath === ".env" && entry.reason === "secret"));
  assert.ok(snapshot.skipped.some((entry) => entry.relativePath === "large.bin" && entry.reason === "too_large"));
});

test("rewind preview categorizes add, modify, delete, unchanged, and skip changes", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, "add-back.txt"), "old", "utf8");
  await writeFile(join(root, "modify.txt"), "old", "utf8");
  await writeFile(join(root, "same.txt"), "same", "utf8");
  await writeFile(join(root, "large.bin"), "too large", "utf8");
  const store = new RewindSnapshotStore({ root, policy: { maxFileBytes: 4 } });
  await store.captureWorkspace("target");

  await rm(join(root, "add-back.txt"));
  await writeFile(join(root, "modify.txt"), "new", "utf8");
  await writeFile(join(root, "delete-me.txt"), "cur", "utf8");

  const preview = await store.previewRestore("target");
  const byPath = new Map(preview.changes.map((change) => [change.relativePath, change.action]));

  assert.equal(byPath.get("add-back.txt"), "add");
  assert.equal(byPath.get("modify.txt"), "modify");
  assert.equal(byPath.get("delete-me.txt"), "delete");
  assert.equal(byPath.get("same.txt"), "unchanged");
  assert.equal(byPath.get("large.bin"), "skip");
});

test("rewind restore returns captured workspace bytes and deletes post-checkpoint files", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await mkdir(join(root, "nested"));
  await writeFile(join(root, "a.txt"), "old-a", "utf8");
  await writeFile(join(root, "nested", "b.txt"), "old-b", "utf8");
  const store = new RewindSnapshotStore({ root });
  await store.captureWorkspace("target");

  await writeFile(join(root, "a.txt"), "new-a", "utf8");
  await rm(join(root, "nested", "b.txt"));
  await writeFile(join(root, "extra.txt"), "extra", "utf8");

  const result = await store.restoreSnapshot("target");

  assert.equal(result.ok, true, result.error);
  assert.equal(await readFile(join(root, "a.txt"), "utf8"), "old-a");
  assert.equal(await readFile(join(root, "nested", "b.txt"), "utf8"), "old-b");
  await assert.rejects(() => stat(join(root, "extra.txt")), /ENOENT/);
});

test("rewind rejects unsafe manifest ids and manifest relative paths", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, "safe.txt"), "safe", "utf8");
  const store = new RewindSnapshotStore({ root });
  await store.captureWorkspace("safe");

  await assert.rejects(() => store.loadSnapshot("../evil"), /Invalid rewind snapshot id/);

  await writeFile(
    join(root, ".pi", "rewind", "manifests", "malicious.json"),
    JSON.stringify({
      storeVersion: 1,
      id: "malicious",
      createdAt: Date.now(),
      root,
      entries: [{ kind: "file", relativePath: "../outside.txt", hash: "a".repeat(64) }],
      skipped: [],
      summary: { capturedFiles: 1, capturedSymlinks: 0, deletedEntries: 0, skipped: 0, capturedBytes: 1, newBytes: 1 },
    }),
    "utf8",
  );

  await assert.rejects(() => store.previewRestore("malicious"), /Invalid rewind manifest entry/);

  await writeFile(
    join(root, ".pi", "rewind", "manifests", "wrong-root.json"),
    JSON.stringify({
      storeVersion: 1,
      id: "wrong-root",
      createdAt: Date.now(),
      root: join(root, "other-root"),
      entries: [],
      skipped: [],
      summary: { capturedFiles: 0, capturedSymlinks: 0, deletedEntries: 0, skipped: 0, capturedBytes: 0, newBytes: 0 },
    }),
    "utf8",
  );
  await assert.rejects(() => store.loadSnapshot("wrong-root"), /Invalid rewind manifest/);
});

test("rewind capture records maxNewBytes budget skips without duplicating stored objects", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, "a.txt"), "12345", "utf8");
  await writeFile(join(root, "b.txt"), "67890", "utf8");
  const store = new RewindSnapshotStore({ root, policy: { maxNewBytes: 6 } });
  const snapshot = await store.captureWorkspace("budget");

  assert.deepEqual(snapshot.entries.map((entry) => entry.relativePath), ["a.txt"]);
  assert.ok(snapshot.skipped.some((entry) => entry.relativePath === "b.txt" && entry.reason === "new_bytes_budget_exceeded"));
  assert.equal(snapshot.summary.newBytes, 5);
  assert.equal(await countObjects(root), 1);
});

test("rewind captures, previews, and restores safe symlinks while skipping escaping symlinks", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, "target.txt"), "target", "utf8");
  await writeFile(join(root, "other.txt"), "other", "utf8");
  await symlink("target.txt", join(root, "link.txt"));
  await symlink("/tmp/pi-gui-rewind-escape", join(root, "escape.txt"));
  const store = new RewindSnapshotStore({ root });
  const snapshot = await store.captureWorkspace("links");

  assert.ok(snapshot.entries.some((entry) => entry.kind === "symlink" && entry.relativePath === "link.txt" && entry.symlinkTarget === "target.txt"));
  assert.ok(snapshot.skipped.some((entry) => entry.relativePath === "escape.txt" && entry.reason === "symlink_escape"));

  await rm(join(root, "link.txt"));
  await symlink("other.txt", join(root, "link.txt"));
  const preview = await store.previewRestore("links");
  assert.equal(new Map(preview.changes.map((change) => [change.relativePath, change.action])).get("link.txt"), "modify");

  const result = await store.restoreSnapshot("links");
  assert.equal(result.ok, true, result.error);
  assert.equal(await readlink(join(root, "link.txt")), "target.txt");
});

test("rewind preview reports overwrite, recreate, and directory conflicts", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, "target.txt"), "target", "utf8");
  await symlink("target.txt", join(root, "missing-link.txt"));
  await writeFile(join(root, "file-vs-link.txt"), "file", "utf8");
  await writeFile(join(root, "file-vs-dir.txt"), "file", "utf8");
  const store = new RewindSnapshotStore({ root });
  await store.captureWorkspace("kinds");

  await rm(join(root, "missing-link.txt"));
  await rm(join(root, "file-vs-link.txt"));
  await symlink("target.txt", join(root, "file-vs-link.txt"));
  await rm(join(root, "file-vs-dir.txt"));
  await mkdir(join(root, "file-vs-dir.txt"));

  const preview = await store.previewRestore("kinds");
  const byPath = new Map(preview.changes.map((change) => [change.relativePath, change]));
  assert.equal(byPath.get("missing-link.txt")?.action, "recreate");
  assert.equal(byPath.get("file-vs-link.txt")?.action, "overwrite");
  assert.equal(byPath.get("file-vs-dir.txt")?.action, "conflict");
});

test("rewind supports a custom store root outside the workspace", async (t) => {
  const root = await createWorkspace();
  const storeRoot = await createWorkspace("pi-gui-rewind-store-");
  t.after(() => rm(root, { recursive: true, force: true }));
  t.after(() => rm(storeRoot, { recursive: true, force: true }));

  await writeFile(join(root, "a.txt"), "alpha", "utf8");
  const store = new RewindSnapshotStore({ root, storeRoot });
  await store.captureWorkspace("outside-store");

  assert.equal(await countObjectsAtStore(storeRoot), 1);
  await assert.rejects(() => stat(join(root, ".pi", "rewind")), /ENOENT/);
});

test("rewind restore rolls touched files back when a later object fails verification", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, "a.txt"), "base-a", "utf8");
  await writeFile(join(root, "b.txt"), "base-b", "utf8");
  const store = new RewindSnapshotStore({ root });
  await store.captureWorkspace("base");

  await writeFile(join(root, "a.txt"), "target-a", "utf8");
  await writeFile(join(root, "b.txt"), "target-b", "utf8");
  const target = await store.captureWorkspace("target");

  await writeFile(join(root, "a.txt"), "dirty-a", "utf8");
  await writeFile(join(root, "b.txt"), "dirty-b", "utf8");

  const bEntry = target.entries.find((entry) => entry.relativePath === "b.txt");
  assert.ok(bEntry?.hash);
  await writeFile(store.getObjectPath(bEntry.hash), "corrupt", "utf8");

  const result = await store.restoreSnapshot("target");

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /hash mismatch/);
  assert.equal(await readFile(join(root, "a.txt"), "utf8"), "dirty-a");
  assert.equal(await readFile(join(root, "b.txt"), "utf8"), "dirty-b");
});

test("rewind rollback deletes files created earlier in a failed restore", async (t) => {
  const root = await createWorkspace();
  t.after(() => rm(root, { recursive: true, force: true }));

  await writeFile(join(root, "existing.txt"), "base", "utf8");
  const store = new RewindSnapshotStore({ root });
  await store.captureWorkspace("base");

  await writeFile(join(root, "created-by-target.txt"), "target-created", "utf8");
  await writeFile(join(root, "existing.txt"), "target-existing", "utf8");
  const target = await store.captureWorkspace("target");

  await rm(join(root, "created-by-target.txt"));
  await writeFile(join(root, "existing.txt"), "dirty-existing", "utf8");

  const existingEntry = target.entries.find((entry) => entry.relativePath === "existing.txt");
  assert.ok(existingEntry?.hash);
  await writeFile(store.getObjectPath(existingEntry.hash), "corrupt", "utf8");

  const result = await store.restoreSnapshot("target");

  assert.equal(result.ok, false);
  assert.match(result.error ?? "", /hash mismatch/);
  await assert.rejects(() => stat(join(root, "created-by-target.txt")), /ENOENT/);
  assert.equal(await readFile(join(root, "existing.txt"), "utf8"), "dirty-existing");
});

async function countObjects(root: string): Promise<number> {
  return countObjectsAtStore(join(root, ".pi", "rewind"));
}

async function countObjectsAtStore(storeRoot: string): Promise<number> {
  const objectRoot = join(storeRoot, "objects", "sha256");
  return countFiles(objectRoot).catch(() => 0);
}

async function countFiles(directory: string): Promise<number> {
  const entries = await readdir(directory, { withFileTypes: true });
  let total = 0;
  for (const entry of entries) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) total += await countFiles(path);
    else if (entry.isFile()) total += 1;
  }
  return total;
}
