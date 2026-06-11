import assert from "node:assert/strict";
import { mkdir, mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { discoverProjectPiExtensions, projectExtensionPathsForCapabilities, resetProjectPiExtensionDiscoveryCacheForTest } from "../src/runtime/piExtensionDiscovery.js";

test("discovers project-local Pi extensions from convention and project settings", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-project-ext-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await mkdir(join(cwd, ".pi", "extensions", "trellis"), { recursive: true });
  await writeFile(join(cwd, ".pi", "extensions", "trellis", "index.ts"), "pi.registerTool?.({ name: \"trellis_subagent\" });", "utf8");
  await writeFile(join(cwd, ".pi", "settings.json"), JSON.stringify({ extensions: ["./extensions/trellis/index.ts"] }), "utf8");

  const extensions = discoverProjectPiExtensions(cwd);

  assert.deepEqual(extensions.map((extension) => extension.relativePath), ["./.pi/extensions/trellis/index.ts"]);
  assert.equal(extensions[0]?.source, "project-settings");
  assert.deepEqual(extensions[0]?.capabilityIds, ["trellis-subagent"]);
});

test("project extension discovery cache returns clones and invalidates when files change", async (t) => {
  resetProjectPiExtensionDiscoveryCacheForTest();
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-project-ext-cache-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));
  t.after(() => resetProjectPiExtensionDiscoveryCacheForTest());

  await mkdir(join(cwd, ".pi", "extensions", "tool"), { recursive: true });
  const extensionFile = join(cwd, ".pi", "extensions", "tool", "index.ts");
  await writeFile(extensionFile, "pi.registerTool?.({ name: 'trellis_subagent' });", "utf8");

  const first = discoverProjectPiExtensions(cwd);
  first[0]?.capabilityIds.push("mutated-test-value");
  assert.deepEqual(discoverProjectPiExtensions(cwd)[0]?.capabilityIds, ["trellis-subagent"]);

  await writeFile(extensionFile, "export default function noop() {};", "utf8");
  assert.deepEqual(discoverProjectPiExtensions(cwd)[0]?.capabilityIds, []);
});

test("uses Pi GUI manifests for project extension capability declarations", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-project-ext-manifest-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await mkdir(join(cwd, ".pi", "extensions", "trellis"), { recursive: true });
  await writeFile(join(cwd, ".pi", "extensions", "trellis", "index.ts"), "export default function () {};", "utf8");
  await writeFile(join(cwd, ".pi", "extensions", "trellis", "pi-gui.manifest.json"), JSON.stringify({
    integrationLevel: 2,
    capabilityIds: ["trellis-subagent"],
  }), "utf8");

  const [extension] = discoverProjectPiExtensions(cwd);

  assert.equal(extension?.integrationLevel, 2);
  assert.deepEqual(extension?.capabilityIds, ["trellis-subagent"]);
  assert.deepEqual(extension?.warnings, []);
});

test("invalid Pi GUI manifests fall back to static capability detection with a manifest warning", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-project-ext-invalid-manifest-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await mkdir(join(cwd, ".pi", "extensions", "trellis"), { recursive: true });
  await writeFile(join(cwd, ".pi", "extensions", "trellis", "index.ts"), "pi.registerTool?.({ name: \"trellis_subagent\" });", "utf8");
  await writeFile(join(cwd, ".pi", "extensions", "trellis", "pi-gui.manifest.json"), "[]", "utf8");

  const [extension] = discoverProjectPiExtensions(cwd);

  assert.equal(extension?.integrationLevel, 0);
  assert.deepEqual(extension?.capabilityIds, ["trellis-subagent"]);
  assert.deepEqual(extension?.warnings, [
    "Invalid pi-gui.manifest.json; expected a JSON object.",
    "Invalid pi-gui.manifest.json; capability match is based on static tool/UI-name detection.",
  ]);
});

test("Pi GUI manifests report unknown capability ids without exposing them as injectable", async (t) => {
  const cwd = await mkdtemp(join(tmpdir(), "pi-gui-project-ext-unknown-manifest-"));
  t.after(() => rm(cwd, { recursive: true, force: true }));

  await mkdir(join(cwd, ".pi", "extensions", "trellis"), { recursive: true });
  await writeFile(join(cwd, ".pi", "extensions", "trellis", "index.ts"), "pi.registerTool?.({ name: \"trellis_subagent\" });", "utf8");
  await writeFile(join(cwd, ".pi", "extensions", "trellis", "pi-gui.manifest.json"), JSON.stringify({
    capabilityIds: ["trellis-subagent", "future-capability"],
  }), "utf8");

  const [extension] = discoverProjectPiExtensions(cwd);

  assert.equal(extension?.integrationLevel, 1);
  assert.deepEqual(extension?.capabilityIds, ["trellis-subagent"]);
  assert.deepEqual(extension?.warnings, ["pi-gui.manifest.json declares unknown capabilityIds: future-capability."]);
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
