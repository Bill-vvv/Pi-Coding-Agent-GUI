import assert from "node:assert/strict";
import test from "node:test";
import { diagnoseEnvironment } from "../src/services/environmentService.js";

type MockExec = (file: string, args: string[]) => { ok: boolean; stdout?: string; stderr?: string; error?: Error };

function baseDependencies(exec: MockExec, overrides: Record<string, unknown> = {}) {
  return {
    now: () => 1_700_000_000_000,
    platform: "linux",
    arch: "x64",
    nodeVersion: "v22.0.0",
    home: () => "/home/tester",
    kernelRelease: () => "5.15.0-microsoft-standard-WSL2",
    readTextFile: async () => "Linux version microsoft WSL2",
    execFile: async (file: string, args: string[]) => {
      const result = exec(file, args);
      return {
        ok: result.ok,
        stdout: result.stdout ?? "",
        stderr: result.stderr ?? "",
        error: result.error,
      };
    },
    rpcSmoke: async () => ({ ok: true, command: "get_available_models", durationMs: 12 }),
    serverConfig: () => ({ host: "127.0.0.1", port: 8787, mode: "test", authRequired: false, remoteLan: false }),
    ...overrides,
  };
}

test("diagnoseEnvironment returns ready desktop diagnostics when WSL, npm, Pi, and RPC smoke are available", async () => {
  const diagnostics = await diagnoseEnvironment({
    env: { WSL_DISTRO_NAME: "Ubuntu", WSL_INTEROP: "/run/WSL/1_interop", HOME: "/home/tester" },
    cwd: "/repo",
    dependencies: baseDependencies((file, args) => {
      if (file === "npm" && args[0] === "--version") return { ok: true, stdout: "10.8.0\n" };
      if (file === "which") return { ok: true, stdout: "/usr/local/bin/pi\n" };
      if (file === "pi") return { ok: true, stdout: "pi 1.2.3\n" };
      return { ok: false, error: new Error("unexpected command") };
    }),
  });

  assert.equal(diagnostics.checkedAt, 1_700_000_000_000);
  assert.equal(diagnostics.cwd, "/repo");
  assert.equal(diagnostics.npmVersion, "10.8.0");
  assert.deepEqual(diagnostics.backend, { host: "127.0.0.1", port: 8787, mode: "test" });
  assert.equal(diagnostics.wsl.isWsl, true);
  assert.equal(diagnostics.pi.installed, true);
  assert.equal(diagnostics.pi.path, "/usr/local/bin/pi");
  assert.equal(diagnostics.pi.version, "pi 1.2.3");
  assert.equal(diagnostics.pi.rpcSmoke?.ok, true);
  assert.equal(diagnostics.readiness?.status, "ready");
  assert.deepEqual(diagnostics.readiness?.issues, []);
});

test("diagnoseEnvironment reports missing Pi without running RPC smoke", async () => {
  let smokeCalled = false;
  const diagnostics = await diagnoseEnvironment({
    env: { WSL_DISTRO_NAME: "Ubuntu", WSL_INTEROP: "1" },
    dependencies: baseDependencies(
      (file) => {
        if (file === "npm") return { ok: true, stdout: "10.0.0\n" };
        return { ok: false, stderr: "not found\n", error: new Error("command failed") };
      },
      { rpcSmoke: async () => { smokeCalled = true; return { ok: false, command: "get_available_models", error: "should not run" }; } },
    ),
  });

  assert.equal(smokeCalled, false);
  assert.equal(diagnostics.pi.installed, false);
  assert.equal(diagnostics.readiness?.status, "error");
  assert.ok(diagnostics.readiness?.issues.some((issue) => issue.code === "pi_not_installed"));
});

test("diagnoseEnvironment distinguishes Pi RPC smoke failure", async () => {
  const diagnostics = await diagnoseEnvironment({
    env: { WSL_DISTRO_NAME: "Ubuntu", WSL_INTEROP: "1" },
    dependencies: baseDependencies(
      (file) => {
        if (file === "npm") return { ok: true, stdout: "10.0.0\n" };
        if (file === "which") return { ok: true, stdout: "/bin/pi\n" };
        return { ok: true, stdout: "pi 1.0.0\n" };
      },
      { rpcSmoke: async () => ({ ok: false, command: "get_available_models", durationMs: 50, error: "auth failed" }) },
    ),
  });

  assert.equal(diagnostics.pi.rpcSmoke?.ok, false);
  assert.equal(diagnostics.readiness?.status, "error");
  const issue = diagnostics.readiness?.issues.find((item) => item.code === "pi_rpc_smoke_failed");
  assert.equal(issue?.detail, "auth failed");
});

test("diagnoseEnvironment uses bounded subprocess checks and surfaces smoke timeouts", async () => {
  const seenTimeouts: Array<{ file: string; timeoutMs: number }> = [];
  const diagnostics = await diagnoseEnvironment({
    env: { WSL_DISTRO_NAME: "Ubuntu", WSL_INTEROP: "1" },
    dependencies: baseDependencies(
      (file) => {
        if (file === "npm") return { ok: true, stdout: "10.0.0\n" };
        if (file === "which") return { ok: true, stdout: "/bin/pi\n" };
        return { ok: true, stdout: "pi 1.0.0\n" };
      },
      {
        execFile: async (file: string, _args: string[], options: { timeoutMs: number }) => {
          seenTimeouts.push({ file, timeoutMs: options.timeoutMs });
          if (file === "npm") return { ok: true, stdout: "10.0.0\n", stderr: "" };
          if (file === "which") return { ok: true, stdout: "/bin/pi\n", stderr: "" };
          return { ok: true, stdout: "pi 1.0.0\n", stderr: "" };
        },
        rpcSmoke: async () => ({ ok: false, command: "get_available_models", durationMs: 5_000, error: "Timed out after 5000ms" }),
      },
    ),
  });

  assert.deepEqual(seenTimeouts, [
    { file: "npm", timeoutMs: 3_000 },
    { file: "which", timeoutMs: 3_000 },
    { file: "pi", timeoutMs: 5_000 },
  ]);
  assert.equal(diagnostics.readiness?.status, "error");
  assert.equal(diagnostics.readiness?.issues.find((issue) => issue.code === "pi_rpc_smoke_failed")?.detail, "Timed out after 5000ms");
});

test("diagnoseEnvironment reports non-WSL and missing npm as actionable readiness issues", async () => {
  const diagnostics = await diagnoseEnvironment({
    env: {},
    dependencies: baseDependencies(
      (file) => {
        if (file === "npm") return { ok: false, stderr: "npm missing\n", error: new Error("ENOENT") };
        if (file === "which") return { ok: true, stdout: "/bin/pi\n" };
        return { ok: true, stdout: "pi 1.0.0\n" };
      },
      {
        kernelRelease: () => "generic-linux",
        readTextFile: async () => "Linux version generic",
      },
    ),
  });

  assert.equal(diagnostics.wsl.isWsl, false);
  assert.equal(diagnostics.npmVersion, undefined);
  assert.equal(diagnostics.readiness?.status, "warning");
  assert.ok(diagnostics.readiness?.issues.some((issue) => issue.code === "wsl_not_detected"));
  assert.ok(diagnostics.readiness?.issues.some((issue) => issue.code === "npm_unavailable"));
});
