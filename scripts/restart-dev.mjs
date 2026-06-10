#!/usr/bin/env node
import { createConnection } from "node:net";
import { chmodSync, closeSync, existsSync, mkdirSync, openSync, readFileSync, unlinkSync, writeFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { execFileSync, spawn } from "node:child_process";

const repoRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const stateDir = resolve(process.env.PI_GUI_DEV_STATE_DIR ?? join(repoRoot, ".pi-gui"));
const pidFile = join(stateDir, "dev.pid");
const logFile = join(stateDir, "dev.log");
const runnerFile = join(stateDir, "dev-runner.sh");
const tmuxSession = process.env.PI_GUI_DEV_TMUX_SESSION ?? "pi-gui-dev";
const tmuxAvailable = process.platform !== "win32" && commandExists("tmux");
const useTmux = tmuxAvailable && process.env.PI_GUI_DEV_USE_TMUX !== "0";
const backendPort = parsePort(process.env.PI_GUI_BACKEND_PORT ?? process.env.PORT, 8787, "backend");
const webPort = parsePort(process.env.PI_GUI_WEB_PORT ?? process.env.VITE_PORT, 5173, "web");
const npmScript = process.env.PI_GUI_DEV_NPM_SCRIPT?.trim() || "dev";
const args = new Set(process.argv.slice(2));
const dryRun = args.has("--dry-run");
const stopOnly = args.has("--stop");
const startOnly = args.has("--start");
const statusOnly = args.has("--status");
const showHelp = args.has("--help") || args.has("-h");

if (showHelp) {
  printHelp();
  process.exit(0);
}

if ([stopOnly, startOnly, statusOnly].filter(Boolean).length > 1) {
  console.error("[pi-gui] Use only one of --stop, --start, or --status.");
  process.exit(1);
}

if (statusOnly) {
  printStatus();
  process.exit(0);
}

if (!startOnly) await stopDevServers();
if (!stopOnly) await startDevServers();

function printHelp() {
  console.log(`Usage: node scripts/restart-dev.mjs [--stop|--start|--status|--dry-run]\n\nRestarts the Pi GUI frontend and backend dev servers.\n\nDefault action: stop any process listening on backend/web dev ports, then start \`npm run ${npmScript}\` in the background.\n\nEnvironment overrides:\n  PI_GUI_BACKEND_PORT / PORT    Backend port, default ${backendPort}\n  PI_GUI_WEB_PORT / VITE_PORT   Web port, default ${webPort}\n  PI_GUI_DEV_NPM_SCRIPT         npm script to start, default ${npmScript}\n  PI_GUI_DEV_STATE_DIR          State/log directory, default ${stateDir}\n  PI_GUI_DEV_USE_TMUX=0         Disable tmux-backed launch\n  PI_GUI_DEV_TMUX_SESSION=name  tmux session name, default ${tmuxSession}`);
}

function parsePort(rawValue, defaultValue, label) {
  const port = Number(rawValue ?? defaultValue);
  if (!Number.isInteger(port) || port <= 0 || port > 65535) {
    console.error(`[pi-gui] Invalid ${label} port: ${rawValue}`);
    process.exit(1);
  }
  return port;
}

function printStatus() {
  const pid = readPidFile();
  const backendPids = listeningPids(backendPort);
  const webPids = listeningPids(webPort);
  console.log(`[pi-gui] pid file: ${pid ? `${pid} (${isRunning(pid) ? "running" : "not running"})` : "none"}`);
  console.log(`[pi-gui] backend : ${formatListeners(backendPort, backendPids)}`);
  console.log(`[pi-gui] web     : ${formatListeners(webPort, webPids)}`);
  console.log(`[pi-gui] tmux    : ${formatTmuxStatus()}`);
  console.log(`[pi-gui] log     : ${logFile}`);
}

function formatListeners(port, pids) {
  if (pids.length === 0) return `no listener on port ${port}`;
  return `port ${port} pid(s) ${pids.map((pid) => `${pid}${commandLabel(pid) ? ` (${commandLabel(pid)})` : ""}`).join(", ")}`;
}

async function stopDevServers() {
  let stoppedSomething = false;
  if (tmuxAvailable && tmuxHasSession()) {
    if (dryRun) {
      console.log(`[pi-gui] Would stop tmux session ${tmuxSession}`);
    } else {
      console.log(`[pi-gui] Stopping tmux session ${tmuxSession}`);
      execFileSync("tmux", ["kill-session", "-t", tmuxSession], { stdio: "ignore" });
    }
    stoppedSomething = true;
  }

  const targetPids = new Set();
  const pid = readPidFile();
  if (pid && isRunning(pid)) targetPids.add(pid);
  for (const listenerPid of listeningPids(backendPort)) targetPids.add(listenerPid);
  for (const listenerPid of listeningPids(webPort)) targetPids.add(listenerPid);

  if (targetPids.size === 0) {
    if (!dryRun) removePidFile();
    if (!stoppedSomething) console.log("[pi-gui] No existing frontend/backend dev server found.");
    return;
  }

  const ownPgid = processGroupId(process.pid);
  const targetGroups = new Map();
  const directPids = new Set();
  for (const targetPid of targetPids) {
    const pgid = processGroupId(targetPid);
    if (pgid && pgid !== ownPgid) {
      targetGroups.set(pgid, targetPid);
    } else {
      directPids.add(targetPid);
    }
  }

  for (const [pgid, samplePid] of targetGroups) {
    const label = commandLabel(samplePid);
    if (dryRun) {
      console.log(`[pi-gui] Would stop dev process group ${pgid} from pid ${samplePid}${label ? ` (${label})` : ""}`);
      continue;
    }
    console.log(`[pi-gui] Stopping dev process group ${pgid} from pid ${samplePid}${label ? ` (${label})` : ""}`);
    await stopProcessGroup(pgid);
  }

  for (const directPid of directPids) {
    const label = commandLabel(directPid);
    if (dryRun) {
      console.log(`[pi-gui] Would stop dev pid ${directPid}${label ? ` (${label})` : ""}`);
      continue;
    }
    console.log(`[pi-gui] Stopping dev pid ${directPid}${label ? ` (${label})` : ""}`);
    await stopPid(directPid);
  }

  if (!dryRun) removePidFile();
}

async function startDevServers() {
  if (dryRun) {
    console.log(`[pi-gui] Would start npm run ${npmScript} in ${repoRoot}${useTmux ? ` using tmux session ${tmuxSession}` : ""}`);
    return;
  }

  if (useTmux) {
    await startDevServersInTmux();
    return;
  }

  mkdirSync(stateDir, { recursive: true });
  const logFd = openSync(logFile, "a");
  const startedAt = new Date().toISOString();
  writeFileSync(logFd, `\n\n[pi-gui] ===== dev restart ${startedAt} =====\n`);

  const npmCommand = process.platform === "win32" ? "npm.cmd" : "npm";
  const child = spawn(npmCommand, ["run", npmScript], {
    cwd: repoRoot,
    detached: true,
    env: process.env,
    stdio: ["ignore", logFd, logFd],
  });

  child.unref();
  closeSync(logFd);
  writeFileSync(pidFile, `${child.pid}\n`);
  console.log(`[pi-gui] Started frontend/backend dev servers with npm run ${npmScript}: pid ${child.pid}`);
  console.log(`[pi-gui] Log: ${logFile}`);
  await reportReadiness();
}

async function startDevServersInTmux() {
  if (tmuxHasSession()) {
    console.error(`[pi-gui] tmux session ${tmuxSession} already exists. Use --stop first or run the default restart command.`);
    process.exit(1);
  }

  mkdirSync(stateDir, { recursive: true });
  const startedAt = new Date().toISOString();
  const runner = `#!/usr/bin/env bash
set -u
cd ${shellQuote(repoRoot)}
mkdir -p ${shellQuote(stateDir)}
printf '\n\n[pi-gui] ===== dev restart %s (tmux:%s) =====\n' ${shellQuote(startedAt)} ${shellQuote(tmuxSession)} >> ${shellQuote(logFile)}
exec npm run ${shellQuote(npmScript)} >> ${shellQuote(logFile)} 2>&1
`;
  writeFileSync(runnerFile, runner);
  chmodSync(runnerFile, 0o755);
  execFileSync("tmux", ["new-session", "-d", "-s", tmuxSession, "-c", repoRoot, runnerFile], { stdio: "ignore" });

  const panePid = tmuxPanePid();
  if (panePid) writeFileSync(pidFile, `${panePid}\n`);
  console.log(`[pi-gui] Started frontend/backend dev servers with npm run ${npmScript} in tmux session ${tmuxSession}${panePid ? `: pane pid ${panePid}` : ""}`);
  console.log(`[pi-gui] Log: ${logFile}`);
  console.log(`[pi-gui] Attach: tmux attach -t ${tmuxSession}`);
  await reportReadiness();
}

async function reportReadiness() {
  const ready = await waitForPorts([
    { label: "backend", port: backendPort },
    { label: "web", port: webPort },
  ], 45_000);

  if (ready.length > 0) {
    console.log(`[pi-gui] Ready: ${ready.map(({ label, port }) => `${label} http://127.0.0.1:${port}`).join(", ")}`);
  }

  const missing = [
    { label: "backend", port: backendPort },
    { label: "web", port: webPort },
  ].filter((target) => !ready.some((item) => item.port === target.port));
  if (missing.length > 0) {
    console.log(`[pi-gui] Still waiting/not detected: ${missing.map(({ label, port }) => `${label} port ${port}`).join(", ")}`);
    console.log("[pi-gui] Check the log if startup does not complete.");
  }
}

function readPidFile() {
  if (!existsSync(pidFile)) return undefined;
  const pid = Number(readFileSync(pidFile, "utf8").trim());
  return Number.isInteger(pid) && pid > 0 ? pid : undefined;
}

function removePidFile() {
  try {
    unlinkSync(pidFile);
  } catch (error) {
    if (!error || typeof error !== "object" || error.code !== "ENOENT") throw error;
  }
}

function isRunning(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch {
    return false;
  }
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

function processGroupId(pid) {
  try {
    const output = execFileSync("ps", ["-p", String(pid), "-o", "pgid="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const pgid = Number(output);
    return Number.isInteger(pgid) && pgid > 0 ? pgid : undefined;
  } catch {
    return undefined;
  }
}

function groupHasProcesses(pgid) {
  try {
    const output = execFileSync("ps", ["-eo", "pgid="], { encoding: "utf8", stdio: ["ignore", "pipe", "ignore"] });
    return output.split("\n").some((line) => Number(line.trim()) === pgid);
  } catch {
    return false;
  }
}

function commandLabel(pid) {
  try {
    return execFileSync("ps", ["-p", String(pid), "-o", "comm="], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim() || undefined;
  } catch {
    return undefined;
  }
}

function commandExists(command) {
  try {
    execFileSync("sh", ["-c", `command -v ${shellQuote(command)}`], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function formatTmuxStatus() {
  if (!tmuxAvailable) return "unavailable";
  if (!tmuxHasSession()) return "none";
  const panePid = tmuxPanePid();
  return `session ${tmuxSession}${panePid ? ` (pane pid ${panePid})` : ""}`;
}

function tmuxHasSession() {
  if (!tmuxAvailable) return false;
  try {
    execFileSync("tmux", ["has-session", "-t", tmuxSession], { stdio: "ignore" });
    return true;
  } catch {
    return false;
  }
}

function tmuxPanePid() {
  if (!tmuxAvailable) return undefined;
  try {
    const output = execFileSync("tmux", ["display-message", "-p", "-t", tmuxSession, "#{pane_pid}"], {
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
    const pid = Number(output);
    return Number.isInteger(pid) && pid > 0 ? pid : undefined;
  } catch {
    return undefined;
  }
}

function shellQuote(value) {
  return `'${String(value).replace(/'/g, `'\\''`)}'`;
}

async function stopProcessGroup(pgid) {
  signalProcessGroup(pgid, "SIGTERM");
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(100);
    if (!groupHasProcesses(pgid)) return;
  }
  console.log(`[pi-gui] Process group ${pgid} did not exit after SIGTERM; sending SIGKILL`);
  signalProcessGroup(pgid, "SIGKILL");
}

function signalProcessGroup(pgid, signal) {
  try {
    process.kill(-pgid, signal);
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") return;
    throw error;
  }
}

async function stopPid(pid) {
  try {
    process.kill(pid, "SIGTERM");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") return;
    throw error;
  }
  for (let attempt = 0; attempt < 30; attempt += 1) {
    await sleep(100);
    if (!isRunning(pid)) return;
  }
  console.log(`[pi-gui] Pid ${pid} did not exit after SIGTERM; sending SIGKILL`);
  try {
    process.kill(pid, "SIGKILL");
  } catch (error) {
    if (error && typeof error === "object" && error.code === "ESRCH") return;
    throw error;
  }
}

async function waitForPorts(targets, timeoutMs) {
  const ready = [];
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline && ready.length < targets.length) {
    for (const target of targets) {
      if (ready.some((item) => item.port === target.port)) continue;
      if (await canConnect(target.port)) ready.push(target);
    }
    if (ready.length < targets.length) await sleep(250);
  }
  return ready;
}

function canConnect(port) {
  return new Promise((resolveConnect) => {
    const socket = createConnection({ host: "127.0.0.1", port, timeout: 250 }, () => {
      socket.destroy();
      resolveConnect(true);
    });
    socket.on("timeout", () => {
      socket.destroy();
      resolveConnect(false);
    });
    socket.on("error", () => resolveConnect(false));
  });
}

function sleep(ms) {
  return new Promise((resolveSleep) => setTimeout(resolveSleep, ms));
}
