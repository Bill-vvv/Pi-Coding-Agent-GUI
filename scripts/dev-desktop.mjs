#!/usr/bin/env node
import { createServer } from "node:net";
import { existsSync, readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { spawn } from "node:child_process";

sanitizeInheritedBackendEnv(process.env);

const repoRoot = repoRootFromNpm();
const localConfig = readLocalDesktopConfig(repoRoot);
const launchMode = process.env.PI_GUI_DESKTOP_LAUNCH_MODE === "built" ? "built" : "dev";
const selectedDesktopHost = normalizeDesktopHost(firstNonBlank(process.env.PI_GUI_DESKTOP_HOST, process.env.PI_GUI_DESKTOP_BACKEND_HOST, localConfig.desktopHost, localConfig.backendHost, "wsl"));
process.env.PI_GUI_DESKTOP_HOST = selectedDesktopHost;
const desktopProfile = applyDesktopProfile(process.env.PI_GUI_DESKTOP_PROFILE);

if (process.platform !== "win32") {
  console.error("Pi GUI Desktop MVP launcher must run from Windows PowerShell/CMD because Electron is Windows + WSL only.");
  process.exit(1);
}

const npmCmd = "npm.cmd";
const npxCmd = "npx.cmd";
const explicitWebUrl = launchMode === "dev" ? process.env.PI_GUI_DESKTOP_WEB_URL?.trim() || undefined : undefined;
const webPort = launchMode === "dev" && !explicitWebUrl ? parsePort(process.env.PI_GUI_WEB_PORT) ?? await findAvailableLoopbackPort() : undefined;
const webUrl = explicitWebUrl ?? (webPort ? `http://127.0.0.1:${webPort}` : undefined);
const wslRepo = wslRepoFromUnc(repoRoot);
const configuredWslRepo = wslRepo ?? wslRepoFromLocalConfig(localConfig);
const electronVersion = electronMajorVersion();
applyDesktopDataDir();

if (desktopProfile) {
  console.log(`[pi-gui] Desktop ${desktopProfile.label}: host ${selectedDesktopHost}, backend http://127.0.0.1:${process.env.PI_GUI_DESKTOP_BACKEND_PORT}, web ${webUrl ?? "built UI"}, data ${process.env.PI_GUI_DATA_DIR}`);
}

if (selectedDesktopHost === "windows") {
  if (wslRepo) {
    console.error("PI_GUI_DESKTOP_HOST=windows requires a Windows filesystem checkout, not a \\wsl.localhost UNC checkout.");
    console.error("Use a Windows-side mirror such as C:\\Users\\<user>\\pi-gui-desktop, or run with PI_GUI_DESKTOP_HOST=wsl.");
    process.exit(1);
  }
  console.log("Using Windows native desktop host. The Windows checkout must have @pi-gui/server dependencies available for the backend.");
  await buildWorkspaceFromWindowsCheckout(launchMode);
  process.exitCode = launchMode === "dev" ? await runDevFromWindowsCheckout(webPort, webUrl) : await runBuiltFromWindowsCheckout();
} else if (wslRepo) {
  console.log(`Detected WSL UNC checkout for distro ${wslRepo.distro}; using WSL for repo commands and Windows npx for Electron.`);
  await buildWorkspaceFromWsl(wslRepo, launchMode);
  process.exitCode = launchMode === "dev" ? await runDevFromWslCheckout(wslRepo, webPort, webUrl) : await runBuiltFromWslCheckout(wslRepo);
} else if (configuredWslRepo) {
  console.log(`Detected Windows desktop checkout with WSL backend source ${configuredWslRepo.cwd} (${configuredWslRepo.distro}).`);
  await buildDesktopFromWindowsCheckout();
  process.exitCode = launchMode === "dev" ? await runDevFromSplitCheckout(configuredWslRepo, webPort, webUrl) : await runBuiltFromSplitCheckout(configuredWslRepo);
} else {
  await buildWorkspaceFromWindowsCheckout(launchMode);
  process.exitCode = launchMode === "dev" ? await runDevFromWindowsCheckout(webPort, webUrl) : await runBuiltFromWindowsCheckout();
}

function normalizeDesktopHost(value) {
  const normalized = String(value ?? "").trim().toLowerCase();
  if (!normalized || normalized === "auto" || normalized === "wsl") return "wsl";
  if (normalized === "windows" || normalized === "win32" || normalized === "native") return "windows";
  console.error(`Unknown PI_GUI_DESKTOP_HOST '${value}'. Expected wsl, windows, or auto.`);
  process.exit(1);
}

function applyDesktopProfile(profileName) {
  const profiles = {
    stable: {
      label: "stable development instance",
      backendPort: "8787",
      webPort: "5173",
      dataDir: ".pi-gui",
    },
    dev: {
      label: "dev revision instance",
      backendPort: "8877",
      webPort: "5273",
      dataDir: ".pi-gui-dev",
      instanceTag: "DEV",
    },
  };

  const name = profileName?.trim().toLowerCase();
  if (!name) return undefined;
  const profile = profiles[name];
  if (!profile) {
    const names = Object.keys(profiles).join("|");
    console.error(`Unknown PI_GUI_DESKTOP_PROFILE '${profileName}'. Expected ${names}.`);
    process.exit(1);
  }

  process.env.PI_GUI_DESKTOP_PROFILE = name;
  process.env.PI_GUI_DESKTOP_BACKEND_PORT = firstNonBlank(process.env.PI_GUI_DESKTOP_BACKEND_PORT, process.env.PI_GUI_BACKEND_PORT, process.env.PORT, profile.backendPort);
  process.env.PORT = firstNonBlank(process.env.PORT, process.env.PI_GUI_DESKTOP_BACKEND_PORT);
  process.env.PI_GUI_WEB_PORT = firstNonBlank(process.env.PI_GUI_WEB_PORT, process.env.VITE_PORT, profile.webPort);
  process.env.VITE_PORT = firstNonBlank(process.env.VITE_PORT, process.env.PI_GUI_WEB_PORT);
  if (profile.instanceTag) {
    process.env.PI_GUI_INSTANCE_TAG = firstNonBlank(process.env.PI_GUI_INSTANCE_TAG, profile.instanceTag);
    process.env.VITE_PI_GUI_INSTANCE_TAG = firstNonBlank(process.env.VITE_PI_GUI_INSTANCE_TAG, process.env.PI_GUI_INSTANCE_TAG);
  }
  return { name, ...profile };
}

function applyDesktopDataDir() {
  const profileDataDir = desktopProfile?.dataDir;
  const explicit = firstNonBlank(process.env.PI_GUI_DESKTOP_DATA_DIR, process.env.PI_GUI_DATA_DIR, profileDataDir);
  const relative = explicit || ".pi-gui";
  process.env.PI_GUI_DATA_DIR = selectedDesktopHost === "wsl"
    ? resolveWslDataDir(relative, configuredWslRepo ?? wslRepo)
    : resolveWindowsDataDir(relative);
}

function readLocalDesktopConfig(root) {
  const path = join(root, ".pi-gui-desktop.local.json");
  if (!existsSync(path)) return {};
  try {
    const parsed = JSON.parse(readFileSync(path, "utf8"));
    return parsed && typeof parsed === "object" ? parsed : {};
  } catch (error) {
    console.warn(`Ignoring invalid ${path}: ${error instanceof Error ? error.message : String(error)}`);
    return {};
  }
}

async function buildWorkspaceFromWsl(repo, mode) {
  await run("wsl.exe", wslArgs(repo, ["npm", "run", "build", "-w", "@pi-gui/shared"]));
  if (mode === "built") {
    await run("wsl.exe", wslArgs(repo, ["npm", "run", "build", "-w", "@pi-gui/server"]));
    await run("wsl.exe", wslArgs(repo, ["npm", "run", "build", "-w", "@pi-gui/web"]));
  }
  await run("wsl.exe", wslArgs(repo, ["npm", "run", "build", "-w", "@pi-gui/desktop"]));
}

async function buildWorkspaceFromWindowsCheckout(mode) {
  await run(npmCmd, ["run", "build", "-w", "@pi-gui/shared"], { cwd: repoRoot });
  if (mode === "built") {
    await run(npmCmd, ["run", "build", "-w", "@pi-gui/web"], { cwd: repoRoot });
  }
  await buildDesktopFromWindowsCheckout();
}

async function buildDesktopFromWindowsCheckout() {
  await run(npmCmd, ["run", "build", "-w", "@pi-gui/desktop"], { cwd: repoRoot });
}

async function runDevFromWslCheckout(repo, port, url) {
  const processes = [];
  if (port) {
    processes.push(spawnManaged("wsl.exe", wslArgs(repo, ["env", ...webDevEnvArgs(port), "npm", "run", "dev", "-w", "@pi-gui/web"]), {
      name: "web",
      env: process.env,
    }));
  }
  processes.push(spawnManaged(npxCmd, ["--yes", `electron@${electronVersion}`, desktopMainPath()], {
    name: "desktop",
    env: desktopEnvForWsl(repo, { mode: "dev", webUrl: url }),
  }));
  return waitForFirstExit(processes);
}

async function runBuiltFromWslCheckout(repo) {
  const desktop = spawnManaged(npxCmd, ["--yes", `electron@${electronVersion}`, desktopMainPath()], {
    name: "desktop",
    env: desktopEnvForWsl(repo, { mode: "built" }),
  });
  return waitForFirstExit([desktop]);
}

async function runDevFromSplitCheckout(repo, port, url) {
  const processes = [];
  if (port) {
    processes.push(spawnManaged("wsl.exe", wslArgs(repo, ["env", ...webDevEnvArgs(port), "npm", "run", "dev", "-w", "@pi-gui/web"]), {
      name: "web",
      env: process.env,
    }));
  }
  const electron = electronCommand(repoRoot);
  processes.push(spawnManaged(electron.command, [...electron.args, desktopMainPath()], {
    name: "desktop",
    cwd: repoRoot,
    env: desktopEnvForWindows({ mode: "dev", webUrl: url, wslRepo: repo }),
  }));
  return waitForFirstExit(processes);
}

async function runBuiltFromSplitCheckout(repo) {
  await run("wsl.exe", wslArgs(repo, ["npm", "run", "build", "-w", "@pi-gui/shared"]));
  await run("wsl.exe", wslArgs(repo, ["npm", "run", "build", "-w", "@pi-gui/web"]));
  const electron = electronCommand(repoRoot);
  const desktop = spawnManaged(electron.command, [...electron.args, desktopMainPath()], {
    name: "desktop",
    cwd: repoRoot,
    env: desktopEnvForWindows({ mode: "built", wslRepo: repo, webIndexPath: wslUncPath(repo, "apps/web/dist/index.html") }),
  });
  return waitForFirstExit([desktop]);
}

async function runDevFromWindowsCheckout(port, url) {
  const processes = [];
  if (port) {
    processes.push(spawnManaged(npmCmd, ["run", "dev", "-w", "@pi-gui/web"], {
      name: "web",
      cwd: repoRoot,
      env: { ...process.env, ...webDevEnvObject(port) },
    }));
  }
  const electron = electronCommand(repoRoot);
  processes.push(spawnManaged(electron.command, [...electron.args, desktopMainPath()], {
    name: "desktop",
    cwd: repoRoot,
    env: desktopEnvForWindows({ mode: "dev", webUrl: url }),
  }));
  return waitForFirstExit(processes);
}

async function runBuiltFromWindowsCheckout() {
  const electron = electronCommand(repoRoot);
  const desktop = spawnManaged(electron.command, [...electron.args, desktopMainPath()], {
    name: "desktop",
    cwd: repoRoot,
    env: desktopEnvForWindows({ mode: "built" }),
  });
  return waitForFirstExit([desktop]);
}

function webDevEnvArgs(port) {
  return Object.entries(webDevEnvObject(port)).map(([key, value]) => `${key}=${value}`);
}

function webDevEnvObject(port) {
  const backendPort = firstNonBlank(process.env.PI_GUI_DESKTOP_BACKEND_PORT, process.env.PI_GUI_BACKEND_PORT, process.env.PORT);
  const backendOrigin = backendPort ? `http://127.0.0.1:${backendPort}` : undefined;
  return {
    PI_GUI_WEB_PORT: String(port),
    ...(backendPort
      ? {
          PI_GUI_BACKEND_PORT: backendPort,
          PI_GUI_BACKEND_ORIGIN: backendOrigin,
          VITE_API_URL: backendOrigin,
          VITE_WS_URL: `ws://127.0.0.1:${backendPort}/ws`,
        }
      : {}),
  };
}

function desktopEnvForWsl(repo, options) {
  return {
    ...process.env,
    PI_GUI_DESKTOP_MODE: options.mode,
    PI_GUI_DESKTOP_HOST: "wsl",
    ...(options.webUrl ? { PI_GUI_DESKTOP_WEB_URL: options.webUrl } : {}),
    PI_GUI_DESKTOP_WSL_CWD: repo.cwd,
    PI_GUI_DESKTOP_WSL_DISTRO: firstNonBlank(process.env.PI_GUI_DESKTOP_WSL_DISTRO, repo.distro),
  };
}

function desktopEnvForWindows(options) {
  const repo = selectedDesktopHost === "wsl" ? options.wslRepo ?? wslRepoFromLocalConfig(localConfig) : undefined;
  return {
    ...process.env,
    PI_GUI_DESKTOP_MODE: options.mode,
    PI_GUI_DESKTOP_HOST: selectedDesktopHost,
    ...(selectedDesktopHost === "windows" ? { PI_GUI_DESKTOP_WINDOWS_CWD: firstNonBlank(process.env.PI_GUI_DESKTOP_WINDOWS_CWD, repoRoot) } : {}),
    ...(options.webUrl ? { PI_GUI_DESKTOP_WEB_URL: options.webUrl } : {}),
    ...(options.webIndexPath ? { PI_GUI_DESKTOP_WEB_INDEX_PATH: options.webIndexPath } : {}),
    ...(repo ? { PI_GUI_DESKTOP_WSL_CWD: repo.cwd, PI_GUI_DESKTOP_WSL_DISTRO: repo.distro } : {}),
  };
}

function desktopMainPath() {
  return join(repoRoot, "apps", "desktop", "dist", "main.js");
}

function repoRootFromNpm() {
  const packageJson = process.env.npm_package_json;
  if (packageJson) return dirname(packageJson);
  return process.cwd();
}

function wslRepoFromUnc(root) {
  const normalized = root.replaceAll("/", "\\");
  if (!normalized.startsWith("\\\\wsl.localhost\\") && !normalized.startsWith("\\\\wsl$\\")) return undefined;
  const parts = normalized.split("\\").filter(Boolean);
  const distro = parts[1];
  const pathParts = parts.slice(2);
  if (!distro || pathParts.length === 0) return undefined;
  const cwd = `/${pathParts.map(encodeWslPathPart).join("/")}`;
  return { distro, cwd };
}

function wslRepoFromLocalConfig(config) {
  const cwd = typeof config.wslCwd === "string" ? config.wslCwd.trim() : "";
  const distro = typeof config.wslDistro === "string" ? config.wslDistro.trim() : "";
  if (!cwd || !distro) return undefined;
  return { cwd, distro };
}

function wslUncPath(repo, relativePath) {
  const suffix = relativePath.split("/").filter(Boolean).join("\\");
  return `\\\\wsl.localhost\\${repo.distro}${repo.cwd.replaceAll("/", "\\")}\\${suffix}`;
}

function encodeWslPathPart(part) {
  return part.replaceAll("\\", "");
}

function wslArgs(repo, command) {
  const distro = firstNonBlank(process.env.PI_GUI_DESKTOP_WSL_DISTRO, repo.distro);
  return ["-d", distro, "--cd", repo.cwd, "--", ...command];
}

function electronCommand(root) {
  const local = join(root, "node_modules", ".bin", "electron.cmd");
  return existsSync(local) ? { command: local, args: [] } : { command: npxCmd, args: ["--yes", `electron@${electronMajorVersion()}`] };
}

function electronMajorVersion() {
  try {
    const pkg = JSON.parse(readFileSync(join(repoRoot, "apps", "desktop", "package.json"), "utf8"));
    const range = pkg.devDependencies?.electron;
    const major = typeof range === "string" ? range.match(/\d+/)?.[0] : undefined;
    return major || "37";
  } catch {
    return "37";
  }
}

function sanitizeInheritedBackendEnv(env) {
  const inherited = String(env.PI_GUI_MODE ?? "").trim().toLowerCase() === "desktop"
    && Boolean(firstNonBlank(env.PI_GUI_AUTH_TOKEN, env.PI_GUI_SERVICE_TIER_FILE, env.PI_GUI_EXECUTION_HOST_KIND));
  if (!inherited) return;

  for (const key of [
    "PI_GUI_MODE",
    "PI_GUI_AUTH_TOKEN",
    "PI_GUI_HOST",
    "PI_GUI_EXECUTION_HOST_KIND",
    "PI_GUI_EXECUTION_HOST_ID",
    "PI_GUI_EXECUTION_HOST_LABEL",
    "PI_GUI_SERVICE_TIER_FILE",
    "PI_GUI_BACKEND_PORT",
    "PORT",
  ]) {
    delete env[key];
  }

  if (!String(env.PI_GUI_DESKTOP_DATA_DIR ?? "").trim()) delete env.PI_GUI_DATA_DIR;
}

function resolveWindowsDataDir(dataDir) {
  if (/^[a-zA-Z]:[\\/]/.test(dataDir) || dataDir.startsWith("\\\\")) return dataDir;
  return join(repoRoot, "apps", "server", dataDir);
}

function resolveWslDataDir(dataDir, repo) {
  if (dataDir.startsWith("/")) return dataDir;
  const root = repo?.cwd || firstNonBlank(process.env.PI_GUI_DESKTOP_WSL_CWD);
  if (!root) return dataDir;
  return `${root.replace(/\/+$/, "")}/apps/server/${dataDir}`;
}

function run(command, args, options = {}) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, args, { stdio: "inherit", shell: shouldUseShell(command), ...options });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${args.join(" ")} exited ${signal ? `with signal ${signal}` : `with code ${code}`}`));
    });
  });
}

function spawnManaged(command, args, options) {
  const child = spawn(command, args, { stdio: "inherit", cwd: options.cwd, env: options.env, shell: shouldUseShell(command) });
  return { name: options.name, child };
}

function shouldUseShell(command) {
  return process.platform === "win32" && /\.(?:cmd|bat)$/i.test(command);
}

function waitForFirstExit(processes) {
  return new Promise((resolveExit) => {
    let settled = false;
    const settle = (item, exitCode) => {
      if (settled) return;
      settled = true;
      for (const other of processes) {
        if (other !== item && other.child.exitCode === null && other.child.signalCode === null) other.child.kill("SIGTERM");
      }
      resolveExit(exitCode);
    };

    for (const item of processes) {
      item.child.on("error", (error) => {
        console.error(`[${item.name}] ${error.message}`);
        settle(item, 1);
      });
      item.child.on("exit", (code, signal) => {
        settle(item, signal ? 1 : code ?? 0);
      });
    }
  });
}

function firstNonBlank(...values) {
  for (const value of values) {
    if (value !== undefined && String(value).trim()) return String(value);
  }
  return "";
}

function parsePort(value) {
  if (!value?.trim()) return undefined;
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 && parsed <= 65535 ? parsed : undefined;
}

function findAvailableLoopbackPort() {
  return new Promise((resolvePort, reject) => {
    const server = createServer();
    server.once("error", reject);
    server.listen(0, "127.0.0.1", () => {
      const address = server.address();
      server.close(() => {
        if (typeof address === "object" && address?.port) resolvePort(address.port);
        else reject(new Error("Unable to allocate a web dev port"));
      });
    });
  });
}
