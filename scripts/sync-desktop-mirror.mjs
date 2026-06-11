#!/usr/bin/env node
import { existsSync } from "node:fs";
import { cp, mkdir, rm } from "node:fs/promises";
import { dirname, isAbsolute, join, resolve } from "node:path";
import { spawn } from "node:child_process";

const repoRoot = repoRootFromNpm();
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const noBuild = args.includes("--no-build");
const targetDir = resolveTargetDir();

const fileEntries = [
  ".gitignore",
  "package.json",
  "package-lock.json",
  "tsconfig.base.json",
  "README.md",
  "README.zh-CN.md",
  "docs/desktop-mvp-validation.md",
  "apps/desktop/package.json",
  "apps/desktop/tsconfig.json",
  "apps/web/index.html",
  "apps/web/package.json",
  "apps/web/tsconfig.json",
  "apps/web/vite.config.ts",
  "apps/server/package.json",
  "apps/server/tsconfig.json",
  "packages/shared/package.json",
  "packages/shared/tsconfig.json",
];

const directoryEntries = [
  "scripts",
  "apps/desktop/src",
  "apps/desktop/test",
  "apps/desktop/assets",
  "apps/web/public",
  "apps/web/src",
  "apps/web/test",
  "apps/server/src",
  "apps/server/scripts",
  "packages/shared/src",
];

if (targetDir === repoRoot) {
  console.error("Refusing to sync desktop mirror: target is the current repository.");
  process.exit(1);
}

if (!existsSync(targetDir)) {
  console.error(`Desktop mirror not found: ${targetDir}`);
  console.error("Create it first or pass --target <path> / set PI_GUI_DESKTOP_MIRROR_DIR.");
  process.exit(1);
}

console.log(`[pi-gui] Syncing desktop mirror: ${repoRoot} -> ${targetDir}${dryRun ? " (dry run)" : ""}`);

for (const relativePath of fileEntries) {
  await copyFileEntry(relativePath);
}

for (const relativePath of directoryEntries) {
  await copyDirectoryEntry(relativePath);
}

if (noBuild || dryRun) {
  console.log(`[pi-gui] Desktop mirror sync ${dryRun ? "dry run " : ""}complete${noBuild ? " (build skipped)" : ""}.`);
} else {
  await buildDesktopInMirror();
  console.log("[pi-gui] Desktop mirror sync and desktop build complete.");
}

function resolveTargetDir() {
  const explicit = valueAfter("--target") ?? process.env.PI_GUI_DESKTOP_MIRROR_DIR;
  if (explicit?.trim()) return resolve(explicit.trim());

  const candidates = [
    "/mnt/c/Users/ceshi/pi-gui-desktop",
    join(dirname(repoRoot), "pi-gui-desktop"),
  ];
  const candidate = candidates.find((path) => existsSync(path));
  if (candidate) return resolve(candidate);

  console.error("Unable to find desktop mirror automatically.");
  console.error("Pass --target <path> or set PI_GUI_DESKTOP_MIRROR_DIR, for example /mnt/c/Users/ceshi/pi-gui-desktop.");
  process.exit(1);
}

function valueAfter(flag) {
  const index = args.indexOf(flag);
  if (index < 0) return undefined;
  return args[index + 1];
}

async function copyFileEntry(relativePath) {
  const source = join(repoRoot, relativePath);
  if (!existsSync(source)) return;
  const target = join(targetDir, relativePath);
  await logOrRun(`copy ${relativePath}`, async () => {
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target);
  });
}

async function copyDirectoryEntry(relativePath) {
  const source = join(repoRoot, relativePath);
  if (!existsSync(source)) return;
  const target = join(targetDir, relativePath);
  await logOrRun(`sync ${relativePath}/`, async () => {
    await rm(target, { recursive: true, force: true });
    await mkdir(dirname(target), { recursive: true });
    await cp(source, target, { recursive: true, filter: syncFilter });
  });
}

function syncFilter(source) {
  const normalized = source.replaceAll("\\", "/");
  return !normalized.includes("/node_modules/") && !normalized.includes("/dist/") && !normalized.includes("/.pi-gui-dev/") && !normalized.includes("/.pi-gui-stable/");
}

async function logOrRun(label, action) {
  console.log(`[pi-gui] ${label}`);
  if (!dryRun) await action();
}

async function buildDesktopInMirror() {
  const command = buildCommand();
  console.log(`[pi-gui] Building desktop in mirror: npm run build -w @pi-gui/desktop`);
  await run(command.command, [...command.args, "run", "build", "-w", "@pi-gui/desktop"], { cwd: targetDir });
}

function buildCommand() {
  if (process.platform === "win32") return { command: "npm.cmd", args: [] };
  const cmdExe = "/mnt/c/Windows/System32/cmd.exe";
  if (existsSync(cmdExe)) return { command: cmdExe, args: ["/C", "npm"] };
  return { command: "npm", args: [] };
}

function run(command, commandArgs, options) {
  return new Promise((resolveRun, reject) => {
    const child = spawn(command, commandArgs, { stdio: "inherit", ...options });
    child.on("error", reject);
    child.on("exit", (code, signal) => {
      if (code === 0) resolveRun();
      else reject(new Error(`${command} ${commandArgs.join(" ")} exited ${signal ? `with signal ${signal}` : `with code ${code}`}`));
    });
  });
}

function repoRootFromNpm() {
  const packageJson = process.env.npm_package_json;
  if (packageJson && isAbsolute(packageJson)) return dirname(packageJson);
  return process.cwd();
}
