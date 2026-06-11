#!/usr/bin/env node
import { existsSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repoRoot = resolve(new URL("..", import.meta.url).pathname);
const packageFiles = [
  "package.json",
  "apps/server/package.json",
  "apps/web/package.json",
  "apps/desktop/package.json",
  "packages/shared/package.json",
];

const forbiddenInstallHooks = new Set([
  "preinstall",
  "install",
  "postinstall",
  "prepare",
  "prepublish",
  "prepublishOnly",
]);

const defaultScriptNames = new Set(["dev", "dev:watch", "start", "build", "typecheck", "test"]);
const riskyDefaultScriptPattern = /(~\/\.pi|\$HOME\/\.pi|%USERPROFILE%\\.pi|netsh\b|portproxy\b|firewall\b|Start-Process\b|powershell\b|preload\b|wrapper\b|CapsWriter\b|pip\s+install|python\b.*server\.py)/i;

const failures = [];

for (const relativePath of packageFiles) {
  const absolutePath = join(repoRoot, relativePath);
  if (!existsSync(absolutePath)) continue;
  const pkg = JSON.parse(readFileSync(absolutePath, "utf8"));
  const scripts = pkg.scripts && typeof pkg.scripts === "object" ? pkg.scripts : {};

  for (const hook of forbiddenInstallHooks) {
    if (Object.prototype.hasOwnProperty.call(scripts, hook)) {
      failures.push(`${relativePath}: install lifecycle script '${hook}' is not allowed for default release safety`);
    }
  }

  for (const [name, value] of Object.entries(scripts)) {
    if (!defaultScriptNames.has(name)) continue;
    if (typeof value === "string" && riskyDefaultScriptPattern.test(value)) {
      failures.push(`${relativePath}: default script '${name}' appears to run risky setup: ${value}`);
    }
  }
}

if (failures.length > 0) {
  console.error("Release safety check failed:");
  for (const failure of failures) console.error(`- ${failure}`);
  process.exit(1);
}

console.log("Release safety check passed: no install hooks or risky default setup scripts found.");
