#!/usr/bin/env node
import { spawn } from "node:child_process";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const repoRoot = join(dirname(fileURLToPath(import.meta.url)), "..");

const profiles = {
  stable: {
    label: "stable dogfood instance",
    backendPort: "8787",
    webPort: "5173",
    dataDir: ".pi-gui-stable",
    tmuxSession: "pi-gui-stable",
  },
  sandbox: {
    label: "feature sandbox instance",
    backendPort: "8877",
    webPort: "5273",
    dataDir: ".pi-gui-dev",
    tmuxSession: "pi-gui-dev-sandbox",
  },
};

const rawArgs = process.argv.slice(2);
const showHelp = rawArgs.includes("--help") || rawArgs.includes("-h");
const profileName = rawArgs.find((arg) => !arg.startsWith("-"));

if (showHelp || !profileName || !profiles[profileName]) {
  printHelp();
  process.exit(showHelp ? 0 : 1);
}

const restartMode = rawArgs.includes("--restart") || rawArgs.includes("--stop") || rawArgs.includes("--start") || rawArgs.includes("--status") || rawArgs.includes("--dry-run");
const passthroughArgs = rawArgs.filter((arg) => arg !== profileName && arg !== "--restart");
const env = profileEnv(profiles[profileName]);

if (rawArgs.includes("--print-env")) {
  printProfileEnv(profileName, profiles[profileName], env);
  process.exit(0);
}

const command = process.platform === "win32" ? "npm.cmd" : "npm";
const childArgs = restartMode
  ? ["run", "dev:restart", "--", ...passthroughArgs]
  : ["run", env.PI_GUI_DEV_NPM_SCRIPT || "dev:watch"];

console.log(`[pi-gui] ${profiles[profileName].label}: backend http://127.0.0.1:${env.PORT}, web http://127.0.0.1:${env.VITE_PORT}, data ${env.PI_GUI_DATA_DIR}`);
const child = spawn(command, childArgs, {
  stdio: "inherit",
  env,
});

child.on("exit", (code, signal) => {
  if (signal) {
    process.kill(process.pid, signal);
    return;
  }
  process.exit(code ?? 0);
});

function profileEnv(profile) {
  const env = { ...process.env };
  const backendPort = firstNonBlank(env.PI_GUI_DEV_PROFILE_BACKEND_PORT, profile.backendPort);
  const webPort = firstNonBlank(env.PI_GUI_DEV_PROFILE_WEB_PORT, profile.webPort);
  const dataDir = resolveDataDir(firstNonBlank(env.PI_GUI_DEV_PROFILE_DATA_DIR, profile.dataDir));

  env.PI_GUI_BACKEND_PORT = backendPort;
  env.PORT = backendPort;
  env.PI_GUI_WEB_PORT = webPort;
  env.VITE_PORT = webPort;
  env.PI_GUI_DATA_DIR = dataDir;
  env.PI_GUI_DEV_STATE_DIR = firstNonBlank(env.PI_GUI_DEV_PROFILE_STATE_DIR, `${dataDir}/dev-state`);
  env.PI_GUI_DEV_TMUX_SESSION = firstNonBlank(env.PI_GUI_DEV_PROFILE_TMUX_SESSION, profile.tmuxSession);
  env.PI_GUI_DEV_NPM_SCRIPT = firstNonBlank(env.PI_GUI_DEV_PROFILE_NPM_SCRIPT, "dev:watch");
  return env;
}

function resolveDataDir(dataDir) {
  if (/^(?:[a-zA-Z]:[\\/]|\\\\|\/)/.test(dataDir)) return dataDir;
  return join(repoRoot, "apps", "server", dataDir);
}

function firstNonBlank(...values) {
  for (const value of values) {
    if (value !== undefined && String(value).trim()) return String(value);
  }
  return "";
}

function printHelp() {
  console.log(`Usage: node scripts/dev-profile.mjs <stable|sandbox> [--restart|--stop|--start|--status|--dry-run|--print-env]

Runs Pi GUI with isolated ports, database, restart state, and tmux session.

Profiles:
  stable   backend 8787, web 5173, data apps/server/.pi-gui-stable
  sandbox  backend 8877, web 5273, data apps/server/.pi-gui-dev

Default action: run npm run dev:watch in the foreground with the selected profile.
Use --restart/--stop/--start/--status to delegate to scripts/restart-dev.mjs with the same profile environment.

Overrides:
  PI_GUI_DEV_PROFILE_BACKEND_PORT
  PI_GUI_DEV_PROFILE_WEB_PORT
  PI_GUI_DEV_PROFILE_DATA_DIR
  PI_GUI_DEV_PROFILE_STATE_DIR
  PI_GUI_DEV_PROFILE_TMUX_SESSION
  PI_GUI_DEV_PROFILE_NPM_SCRIPT

Generic backend env such as PORT and PI_GUI_DATA_DIR is intentionally ignored
so stable/sandbox profiles do not accidentally share a running dev instance.`);
}

function printProfileEnv(profileName, profile, env) {
  console.log(`[pi-gui] ${profileName}: ${profile.label}`);
  for (const key of [
    "PORT",
    "PI_GUI_BACKEND_PORT",
    "VITE_PORT",
    "PI_GUI_WEB_PORT",
    "PI_GUI_DATA_DIR",
    "PI_GUI_DEV_STATE_DIR",
    "PI_GUI_DEV_TMUX_SESSION",
    "PI_GUI_DEV_NPM_SCRIPT",
  ]) {
    console.log(`${key}=${env[key] ?? ""}`);
  }
}
