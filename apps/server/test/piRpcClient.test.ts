import assert from "node:assert/strict";
import { chmodSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";
import { PiRpcClient } from "../src/runtime/piRpcClient.js";
import { createPiRuntimeClient } from "../src/runtime/piRuntimeFactory.js";

function createFakePiBin(script: string): string {
  const dir = mkdtempSync(join(tmpdir(), "pi-gui-fake-pi-"));
  const bin = join(dir, "pi");
  writeFileSync(bin, script, "utf8");
  chmodSync(bin, 0o755);
  return dir;
}

function withPathPrefix<T>(prefix: string, run: () => Promise<T>): Promise<T> {
  const previousPath = process.env.PATH;
  process.env.PATH = `${prefix}${previousPath ? `:${previousPath}` : ""}`;
  return run().finally(() => {
    if (previousPath === undefined) delete process.env.PATH;
    else process.env.PATH = previousPath;
  });
}

async function withCwd<T>(cwd: string, run: () => Promise<T>): Promise<T> {
  const previousCwd = process.cwd();
  process.chdir(cwd);
  try {
    return await run();
  } finally {
    process.chdir(previousCwd);
  }
}

function onceClientEvent<T extends unknown[]>(client: PiRpcClient, event: "event" | "stderr" | "error" | "exit"): Promise<T> {
  return new Promise((resolve) => client.once(event, (...args) => resolve(args as T)));
}

function waitForPiEvent(client: PiRpcClient, predicate: (payload: unknown) => boolean): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const timeout = setTimeout(() => {
      cleanup();
      reject(new Error("Timed out waiting for Pi RPC event"));
    }, 2000);

    const onEvent = (payload: unknown) => {
      if (!predicate(payload)) return;
      cleanup();
      resolve(payload);
    };
    const onError = (error: Error) => {
      cleanup();
      reject(error);
    };
    const cleanup = () => {
      clearTimeout(timeout);
      client.off("event", onEvent);
      client.off("error", onError);
    };

    client.on("event", onEvent);
    client.on("error", onError);
  });
}

test("PiRpcClient starts pi --mode rpc with cwd and option args, and keeps stderr separate", async () => {
  const fakeBin = createFakePiBin(`#!/usr/bin/env node
process.stderr.write("fake-stderr\\n");
process.stdout.write(JSON.stringify({ type: "started", argv: process.argv.slice(2), cwd: process.cwd() }) + "\\n");
process.stdin.resume();
`);
  const cwd = mkdtempSync(join(tmpdir(), "pi-gui-pi-cwd-"));

  await withPathPrefix(fakeBin, async () => {
    const client = new PiRpcClient(cwd, { session: "session-abc", model: "openai:gpt-5", thinkingLevel: "high" });
    const stderrPromise = onceClientEvent<[string]>(client, "stderr");
    const startedPromise = waitForPiEvent(client, (payload) => typeof payload === "object" && payload !== null && (payload as { type?: unknown }).type === "started");

    client.start();
    const started = (await startedPromise) as { argv: string[]; cwd: string };
    const [stderr] = await stderrPromise;

    assert.deepEqual(started.argv, ["--mode", "rpc", "--session", "session-abc", "--model", "openai:gpt-5", "--thinking", "high"]);
    assert.equal(started.cwd, cwd);
    assert.equal(stderr, "fake-stderr\n");

    client.stop();
    await onceClientEvent(client, "exit");
  });
});

test("PiRpcClient passes extension paths as repeated --extension args", async () => {
  const fakeBin = createFakePiBin(`#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "started", argv: process.argv.slice(2) }) + "\\n");
process.stdin.resume();
`);

  await withPathPrefix(fakeBin, async () => {
    const client = new PiRpcClient(process.cwd(), { extensionPaths: ["/tmp/one-extension.ts", "/tmp/two-extension.ts"] });
    const startedPromise = waitForPiEvent(client, (payload) => typeof payload === "object" && payload !== null && (payload as { type?: unknown }).type === "started");

    client.start();
    const started = (await startedPromise) as { argv: string[] };

    assert.deepEqual(started.argv, ["--mode", "rpc", "--extension", "/tmp/one-extension.ts", "--extension", "/tmp/two-extension.ts"]);

    client.stop();
    await onceClientEvent(client, "exit");
  });
});

test("createPiRuntimeClient launches GUI-managed runtimes with internal extensions", async () => {
  const fakeBin = createFakePiBin(`#!/usr/bin/env node
process.stdout.write(JSON.stringify({ type: "started", argv: process.argv.slice(2) }) + "\\n");
process.stdin.resume();
`);
  const cwd = mkdtempSync(join(tmpdir(), "pi-gui-factory-cwd-"));

  await withCwd(cwd, () =>
    withPathPrefix(fakeBin, async () => {
      const { client } = createPiRuntimeClient({ runtimeId: "runtime-extensions", cwd, model: "openai:gpt-5", thinkingLevel: "high" });
      const startedPromise = waitForPiEvent(client, (payload) => typeof payload === "object" && payload !== null && (payload as { type?: unknown }).type === "started");

      try {
        client.start();
        const started = (await startedPromise) as { argv: string[] };
        const extensionPaths = extensionArgsFromArgv(started.argv);

        assert.equal(started.argv.slice(0, 6).join("\0"), ["--mode", "rpc", "--model", "openai:gpt-5", "--thinking", "high"].join("\0"));
        assert.equal(extensionPaths.length, 3);
        assert.ok(extensionPaths.some((path) => /piServiceTierExtension\.(?:ts|js)$/.test(path)));
        assert.ok(extensionPaths.some((path) => /piReadyNotificationExtension\.(?:ts|js)$/.test(path)));
        assert.ok(extensionPaths.some((path) => /piCodexTransportMonitorExtension\.(?:ts|js)$/.test(path)));
      } finally {
        client.stop();
        await onceClientEvent(client, "exit");
      }
    }),
  );
});

test("PiRpcClient writes commands to stdin as LF-delimited JSONL", async () => {
  const fakeBin = createFakePiBin(`#!/usr/bin/env node
let buffer = "";
process.stdin.setEncoding("utf8");
process.stdin.on("data", (chunk) => {
  buffer += chunk;
  let index;
  while ((index = buffer.indexOf("\\n")) !== -1) {
    const line = buffer.slice(0, index);
    buffer = buffer.slice(index + 1);
    process.stdout.write(JSON.stringify({ type: "stdin_line", line }) + "\\n");
  }
});
process.stdin.resume();
`);
  const cwd = mkdtempSync(join(tmpdir(), "pi-gui-pi-cwd-"));

  await withPathPrefix(fakeBin, async () => {
    const client = new PiRpcClient(cwd);
    const linePromise = waitForPiEvent(client, (payload) => typeof payload === "object" && payload !== null && (payload as { type?: unknown }).type === "stdin_line");

    client.start();
    client.send({ id: "req-1", type: "prompt", message: "hello" });

    const payload = (await linePromise) as { line: string };
    assert.equal(payload.line, JSON.stringify({ id: "req-1", type: "prompt", message: "hello" }));

    client.stop();
    await onceClientEvent(client, "exit");
  });
});

test("PiRpcClient reports process exit codes without mixing stderr into JSONL events", async () => {
  const fakeBin = createFakePiBin(`#!/usr/bin/env node
process.stderr.write("fatal stderr\\n");
process.stdout.write(JSON.stringify({ type: "before_exit" }) + "\\n");
process.exit(7);
`);

  await withPathPrefix(fakeBin, async () => {
    const client = new PiRpcClient(process.cwd());
    const stderrPromise = onceClientEvent<[string]>(client, "stderr");
    const eventPromise = waitForPiEvent(client, (payload) => typeof payload === "object" && payload !== null && (payload as { type?: unknown }).type === "before_exit");
    const exitPromise = onceClientEvent<[number | null, NodeJS.Signals | null]>(client, "exit");

    client.start();

    assert.deepEqual(await eventPromise, { type: "before_exit" });
    assert.equal((await stderrPromise)[0], "fatal stderr\n");
    assert.deepEqual(await exitPromise, [7, null]);
  });
});

test("PiRpcClient turns set_service_tier into config file updates and synthetic responses", async () => {
  const fakeBin = createFakePiBin(`#!/usr/bin/env node
process.stdin.resume();
`);
  const serviceTierConfigFile = join(mkdtempSync(join(tmpdir(), "pi-gui-tier-")), "service-tier.json");

  await withPathPrefix(fakeBin, async () => {
    const client = new PiRpcClient(process.cwd(), { serviceTierConfigFile });
    const responsePromise = waitForPiEvent(client, (payload) => typeof payload === "object" && payload !== null && (payload as { command?: unknown }).command === "set_service_tier");

    client.start();
    client.send({ id: "tier-1", type: "set_service_tier", serviceTier: "priority" });

    assert.deepEqual(JSON.parse(readText(serviceTierConfigFile)), { serviceTier: "priority" });
    assert.deepEqual(await responsePromise, {
      id: "tier-1",
      type: "response",
      command: "set_service_tier",
      success: true,
      data: { serviceTier: "priority" },
    });

    client.stop();
    await onceClientEvent(client, "exit");
  });
});

test("PiRpcClient launches SSH project cwd through remote pi rpc", async (t) => {
  const temp = mkdtempSync(join(tmpdir(), "pi-gui-rpc-ssh-"));
  const bin = join(temp, "bin");
  const remoteCwd = join(temp, "remote");
  mkdirSync(bin);
  mkdirSync(remoteCwd);
  t.after(() => rmSync(temp, { recursive: true, force: true }));

  writeFileSync(
    join(bin, "ssh"),
    `#!/usr/bin/env bash\nset -euo pipefail\ncmd="\${@: -1}"\neval "exec $cmd"\n`,
    "utf8",
  );
  chmodSync(join(bin, "ssh"), 0o755);

  writeFileSync(
    join(bin, "pi"),
    `#!/usr/bin/env node\n` +
      `let buffer = "";\n` +
      `process.stdin.on("data", (chunk) => {\n` +
      `  buffer += chunk.toString("utf8");\n` +
      `  for (;;) {\n` +
      `    const idx = buffer.indexOf("\\n");\n` +
      `    if (idx === -1) break;\n` +
      `    const line = buffer.slice(0, idx);\n` +
      `    buffer = buffer.slice(idx + 1);\n` +
      `    if (!line.trim()) continue;\n` +
      `    const req = JSON.parse(line);\n` +
      `    if (req.type === "get_state") {\n` +
      `      console.log(JSON.stringify({ id: req.id, type: "response", command: "get_state", success: true, data: { model: null, thinkingLevel: "off", isStreaming: false, sessionFile: process.cwd() + "/session.jsonl" } }));\n` +
      `    }\n` +
      `  }\n` +
      `});\n`,
    "utf8",
  );
  chmodSync(join(bin, "pi"), 0o755);

  await withPathPrefix(bin, async () => {
    const client = new PiRpcClient(`fakehost:${remoteCwd}`);
    client.start();
    const response = await client.request({ id: "req-1", type: "get_state" });

    assert.equal(response.success, true);
    assert.equal((response.data as { sessionFile?: string }).sessionFile, `${remoteCwd}/session.jsonl`);

    client.stop();
    await onceClientEvent(client, "exit");
  });
});

function readText(path: string): string {
  return readFileSync(path, "utf8");
}

function extensionArgsFromArgv(argv: string[]): string[] {
  const paths: string[] = [];
  for (let index = 0; index < argv.length; index += 1) {
    if (argv[index] === "--extension" && argv[index + 1]) paths.push(argv[index + 1]);
  }
  return paths;
}
