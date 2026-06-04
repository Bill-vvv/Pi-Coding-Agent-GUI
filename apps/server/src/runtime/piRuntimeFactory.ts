import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import type { ResponseMode, ThinkingLevel } from "@pi-gui/shared";
import { PiRpcClient } from "./piRpcClient.js";
import { serviceTierConfigPath, writeServiceTierConfig } from "./serviceTierConfig.js";

const INTERNAL_EXTENSION_PATHS = [resolveSiblingExtensionPath("piServiceTierExtension"), resolveSiblingExtensionPath("piReadyNotificationExtension")];

export type PiRuntimeClientOptions = {
  runtimeId: string;
  cwd: string;
  session?: string;
  model?: string;
  thinkingLevel?: ThinkingLevel;
  responseMode?: ResponseMode;
};

export type PiRuntimeClientBundle = {
  client: PiRpcClient;
  serviceTierConfigFile: string;
};

export function createPiRuntimeClient(options: PiRuntimeClientOptions): PiRuntimeClientBundle {
  const serviceTierConfigFile = serviceTierConfigPath(options.runtimeId);
  writeServiceTierConfig(serviceTierConfigFile, options.responseMode);
  return {
    serviceTierConfigFile,
    client: new PiRpcClient(options.cwd, {
      session: options.session,
      model: options.model,
      thinkingLevel: options.thinkingLevel,
      serviceTierConfigFile,
      extensionPaths: INTERNAL_EXTENSION_PATHS,
    }),
  };
}

function resolveSiblingExtensionPath(baseName: string): string {
  const jsPath = fileURLToPath(new URL(`./${baseName}.js`, import.meta.url));
  if (existsSync(jsPath)) return jsPath;

  const tsPath = fileURLToPath(new URL(`./${baseName}.ts`, import.meta.url));
  if (existsSync(tsPath)) return tsPath;

  return jsPath;
}
