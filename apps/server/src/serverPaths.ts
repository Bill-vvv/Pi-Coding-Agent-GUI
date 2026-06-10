import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";

export function serverPackageRoot(fromUrl = import.meta.url): string {
  return resolve(dirname(fileURLToPath(fromUrl)), "..");
}

export function defaultGuiDataDir(fromUrl = import.meta.url): string {
  return resolve(serverPackageRoot(fromUrl), ".pi-gui");
}

export function legacyDesktopGuiDataDir(fromUrl = import.meta.url): string {
  return resolve(serverPackageRoot(fromUrl), ".pi-gui-desktop");
}

export function resolveGuiDataDir(value: string | undefined, fromUrl = import.meta.url): string {
  const explicit = value?.trim();
  if (!explicit) return defaultGuiDataDir(fromUrl);
  return isAbsolute(explicit) ? explicit : resolve(serverPackageRoot(fromUrl), explicit);
}

export function defaultDbPath(env: NodeJS.ProcessEnv = process.env, fromUrl = import.meta.url): string {
  return resolve(resolveGuiDataDir(env.PI_GUI_DATA_DIR, fromUrl), "pi-gui.sqlite");
}

export function legacyDesktopDbPath(fromUrl = import.meta.url): string {
  return resolve(legacyDesktopGuiDataDir(fromUrl), "pi-gui.sqlite");
}
