import assert from "node:assert/strict";
import test from "node:test";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { defaultDbPath, defaultGuiDataDir, legacyDesktopDbPath, legacyDesktopGuiDataDir, resolveGuiDataDir, serverPackageRoot } from "../src/serverPaths.js";

const sourceUrl = new URL("../src/serverPaths.ts", import.meta.url).href;
const expectedRoot = resolve(dirname(fileURLToPath(sourceUrl)), "..");

test("server data paths are stable relative to the server package root", () => {
  assert.equal(serverPackageRoot(sourceUrl), expectedRoot);
  assert.equal(defaultGuiDataDir(sourceUrl), resolve(expectedRoot, ".pi-gui"));
  assert.equal(legacyDesktopGuiDataDir(sourceUrl), resolve(expectedRoot, ".pi-gui-desktop"));
  assert.equal(resolveGuiDataDir(undefined, sourceUrl), resolve(expectedRoot, ".pi-gui"));
  assert.equal(resolveGuiDataDir(".pi-gui-dev", sourceUrl), resolve(expectedRoot, ".pi-gui-dev"));
  assert.equal(resolveGuiDataDir("/tmp/pi-gui-data", sourceUrl), "/tmp/pi-gui-data");
  assert.equal(defaultDbPath({}, sourceUrl), resolve(expectedRoot, ".pi-gui", "pi-gui.sqlite"));
  assert.equal(legacyDesktopDbPath(sourceUrl), resolve(expectedRoot, ".pi-gui-desktop", "pi-gui.sqlite"));
  assert.equal(defaultDbPath({ PI_GUI_DATA_DIR: ".pi-gui-desktop" }, sourceUrl), resolve(expectedRoot, ".pi-gui-desktop", "pi-gui.sqlite"));
});
