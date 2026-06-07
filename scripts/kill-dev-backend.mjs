#!/usr/bin/env node
import { execFileSync } from "node:child_process";

const DEFAULT_PORT = 8787;
const dryRun = process.argv.includes("--dry-run");
const portArg = process.argv.slice(2).find((arg) => !arg.startsWith("--"));
const port = Number(process.env.PORT ?? portArg ?? DEFAULT_PORT);

if (!Number.isInteger(port) || port <= 0 || port > 65535) {
  console.error(`[pi-gui] Invalid backend port: ${process.env.PORT ?? process.argv[2]}`);
  process.exit(1);
}

const pids = listeningPids(port);
if (pids.length === 0) process.exit(0);

for (const pid of pids) {
  const label = commandLabel(pid);
  if (dryRun) {
    console.log(`[pi-gui] Would stop existing backend on port ${port}: pid ${pid}${label ? ` (${label})` : ""}`);
    continue;
  }
  console.log(`[pi-gui] Stopping existing backend on port ${port}: pid ${pid}${label ? ` (${label})` : ""}`);
  await stopProcess(pid, port);
}

function listeningPids(targetPort) {
  let output;
  try {
    output = execFileSync("ss", ["-ltnp"], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
  } catch {
    return [];
  }

  const pids = new Set();
  for (const line of output.split("\n")) {
    if (!line.includes(`:${targetPort}`)) continue;
    const localAddress = line.trim().split(/\s+/)[3] ?? "";
    if (!localAddress.endsWith(`:${targetPort}`)) continue;
    for (const match of line.matchAll(/pid=(\d+)/g)) {
      const pid = Number(match[1]);
      if (Number.isInteger(pid) && pid > 0 && pid !== process.pid && pid !== process.ppid) pids.add(pid);
    }
  }
  return [...pids];
}

function commandLabel(pid) {
  try {
    const command = execFileSync("ps", ["-p", String(pid), "-o", "comm="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] }).trim();
    return command || undefined;
  } catch {
    return undefined;
  }
}

async function stopProcess(pid, targetPort) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return;
    throw error;
  }

  for (let attempt = 0; attempt < 20; attempt += 1) {
    await sleep(100);
    if (!listeningPids(targetPort).includes(pid)) return;
  }

  console.log(`[pi-gui] Existing backend on port ${targetPort} did not exit after SIGTERM; sending SIGKILL to pid ${pid}`);
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error && typeof error === "object" && "code" in error && error.code === "ESRCH") return;
    throw error;
  }
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}
