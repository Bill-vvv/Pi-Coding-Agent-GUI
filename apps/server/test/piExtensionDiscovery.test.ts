import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverProjectPiExtensions, projectExtensionPathsForCapabilities } from "../src/runtime/piExtensionDiscovery.js";

test("discovers project-local Pi extensions from convention and project settings", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-project-ext-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await mkdir(join(cwd, ".pi", "extensions", "trellis"), { recursive: true });
  await mkdir(join(cwd, ".pi", "extra-extensions", "batch-clarify"), { recursive: true });
  await writeFile(join(cwd, ".pi", "extensions", "trellis", "index.ts"), "pi.registerTool?.({ name: \"trellis_subagent\" });", "utf8");
  await writeFile(join(cwd, ".pi", "extra-extensions", "batch-clarify", "index.ts"), "pi.registerTool({ name: 'ask_batch' });", "utf8");
  await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ extensions: ["./extensions/trellis/index.ts", "./extra-extensions/batch-clarify"] }), "utf8");

  const extensions = discoverProjectPiExtensions(cwd);

  assert.deepEqual(extensions.map((extension) => extension.relativePath), [
    "./.pi/extensions/trellis/index.ts",
    "./.pi/extra-extensions/batch-clarify/index.ts",
  ]);
  assert.equal(extensions[0]?.source, "project-settings");
  assert.deepEqual(extensions[0]?.capabilityIds, ["trellis-subagent"]);
  assert.deepEqual(extensions[1]?.capabilityIds, ["interactive-prompts"]);
});

test("capability selection returns only matching project extension paths", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-project-ext-select-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await mkdir(join(cwd, ".pi", "extensions", "trellis"), { recursive: true });
  await mkdir(join(cwd, ".pi", "extensions", "unknown"), { recursive: true });
  await writeFile(join(cwd, ".pi", "extensions", "trellis", "index.ts"), "pi.registerTool?.({ name: \"trellis_subagent\" });", "utf8");
  await writeFile(join(cwd, ".pi", "extensions", "unknown", "index.ts"), "export default function () {};", "utf8");

  const [trellisExtension] = discoverProjectPiExtensions(cwd);
  const paths = projectExtensionPathsForCapabilities(cwd, ["trellis-subagent"], [trellisExtension?.id ?? ""]);

  assert.equal(paths.length, 1);
  assert.match(paths[0] ?? "", /\.pi\/extensions\/trellis\/index\.ts$/);
  assert.deepEqual(projectExtensionPathsForCapabilities(cwd, ["trellis-subagent"], []), []);
});

test("discovery ignores settings paths outside the selected project before scanning", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-project-ext-safe-"));
  const outside = await mkdtemp(join(tmpdir(), "pi-gui-project-ext-outside-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  t.after(() => rm(outside, { recursive: true, force: true }));

  await mkdir(join(cwd, ".pi"), { recursive: true });
  await mkdir(join(outside, "nested"), { recursive: true });
  await writeFile(join(outside, "index.ts"), "pi.registerTool?.({ name: \"trellis_subagent\" });", "utf8");
  await writeFile(join(outside, "nested", "index.ts"), "pi.registerTool?.({ name: \"ask_batch\" });", "utf8");
  await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ extensions: [join(outside, "index.ts"), outside] }), "utf8");

  assert.deepEqual(discoverProjectPiExtensions(cwd), []);
});

test("project settings exclusions suppress convention and settings-discovered extensions", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-project-ext-exclude-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await mkdir(join(cwd, ".pi", "extensions", "enabled"), { recursive: true });
  await mkdir(join(cwd, ".pi", "extensions", "disabled"), { recursive: true });
  await writeFile(join(cwd, ".pi", "extensions", "enabled", "index.ts"), "pi.registerTool?.({ name: \"trellis_subagent\" });", "utf8");
  await writeFile(join(cwd, ".pi", "extensions", "disabled", "index.ts"), "pi.registerTool?.({ name: \"trellis_subagent\" });", "utf8");
  await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ extensions: ["./extensions", "!./extensions/disabled"] }), "utf8");

  assert.deepEqual(discoverProjectPiExtensions(cwd).map((extension) => extension.relativePath), ["./.pi/extensions/enabled/index.ts"]);
});

test("capability detection reads only the bounded file prefix", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-project-ext-large-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await mkdir(join(cwd, ".pi", "extensions"), { recursive: true });
  await writeFile(join(cwd, ".pi", "extensions", "late.ts"), `${"/".repeat(140 * 1024)}\npi.registerTool?.({ name: \"trellis_subagent\" });`, "utf8");

  const [extension] = discoverProjectPiExtensions(cwd);
  assert.deepEqual(extension?.capabilityIds, []);
});
