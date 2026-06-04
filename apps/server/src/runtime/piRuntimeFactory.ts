import type { ResponseMode, ThinkingLevel } from "@pi-gui/shared";
import { PiRpcClient } from "./piRpcClient.js";
import { serviceTierConfigPath, writeServiceTierConfig } from "./serviceTierConfig.js";

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
    }),
  };
}
