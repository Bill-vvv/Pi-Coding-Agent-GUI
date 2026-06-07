import assert from "node:assert/strict";
import test from "node:test";
import { convertProjectPath, resolveProjectPath } from "../src/services/pathResolutionService.js";

const wslEnv = { isWsl: true, distroName: "Ubuntu", driveMountRoot: "/mnt" };

test("convertProjectPath preserves Linux absolute paths", () => {
  const result = convertProjectPath("/home/me/project", wslEnv);
  assert.equal(result.source, "linux");
  assert.equal(result.cwd, "/home/me/project");
  assert.equal(result.errorCode, undefined);
});

test("convertProjectPath converts Windows drive paths before POSIX normalization", () => {
  assert.equal(convertProjectPath("C:\\Users\\me\\project", wslEnv).cwd, "/mnt/c/Users/me/project");
  assert.equal(convertProjectPath("D:/Work/pi gui", wslEnv).cwd, "/mnt/d/Work/pi gui");
  assert.equal(convertProjectPath("C:\\..\\Windows", wslEnv).cwd, "/mnt/c/Windows");
});

test("convertProjectPath rejects Windows drive paths outside WSL", () => {
  const result = convertProjectPath("C:\\Users\\me\\project", { ...wslEnv, isWsl: false });
  assert.equal(result.source, "windows-drive");
  assert.equal(result.errorCode, "windows_path_requires_wsl");
});

test("convertProjectPath converts current-distro WSL UNC paths", () => {
  assert.equal(convertProjectPath("\\\\wsl.localhost\\Ubuntu\\home\\me\\project", wslEnv).cwd, "/home/me/project");
  assert.equal(convertProjectPath("\\\\wsl$\\ubuntu\\home\\me\\project", wslEnv).cwd, "/home/me/project");
});

test("convertProjectPath rejects mismatched WSL UNC distros", () => {
  const result = convertProjectPath("\\\\wsl.localhost\\Debian\\home\\me\\project", wslEnv);
  assert.equal(result.source, "wsl-unc");
  assert.equal(result.errorCode, "wsl_unc_distro_mismatch");
});

test("convertProjectPath accepts SSH remote project specs", () => {
  const scp = convertProjectPath("devbox:/srv/app", wslEnv);
  assert.equal(scp.source, "ssh");
  assert.equal(scp.cwd, "devbox:/srv/app");
  assert.equal(scp.errorCode, undefined);

  const url = convertProjectPath("ssh://user@devbox:2222/srv/app", wslEnv);
  assert.equal(url.source, "ssh");
  assert.equal(url.cwd, "ssh://user@devbox:2222/srv/app");
});

test("convertProjectPath rejects relative paths, drive-relative paths, and shell home expansion", () => {
  assert.equal(convertProjectPath("relative/project", wslEnv).errorCode, "relative_path");
  assert.equal(convertProjectPath("C:Users\\me\\project", wslEnv).errorCode, "relative_path");
  assert.equal(convertProjectPath("~/project", wslEnv).errorCode, "home_expansion_unsupported");
});

test("resolveProjectPath treats SSH specs as remote directories without local stat", async () => {
  const result = await resolveProjectPath("devbox:/srv/app", {
    ...wslEnv,
    stat: async () => {
      throw new Error("stat should not be called for SSH specs");
    },
  });
  assert.equal(result.source, "ssh");
  assert.equal(result.cwd, "devbox:/srv/app");
  assert.equal(result.exists, true);
  assert.equal(result.isDirectory, true);
});

test("resolveProjectPath validates existence and directory status", async () => {
  const ok = await resolveProjectPath("/home/me/project", {
    ...wslEnv,
    stat: async (path) => ({ isDirectory: () => path === "/home/me/project" }),
  });
  assert.equal(ok.exists, true);
  assert.equal(ok.isDirectory, true);
  assert.equal(ok.cwd, "/home/me/project");

  const file = await resolveProjectPath("/home/me/file.txt", {
    ...wslEnv,
    stat: async () => ({ isDirectory: () => false }),
  });
  assert.equal(file.exists, true);
  assert.equal(file.isDirectory, false);
  assert.equal(file.errorCode, "path_not_directory");

  const missing = await resolveProjectPath("/home/me/missing", {
    ...wslEnv,
    stat: async () => {
      throw new Error("ENOENT");
    },
  });
  assert.equal(missing.exists, false);
  assert.equal(missing.errorCode, "path_not_found");
});
