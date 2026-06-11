const PI_GUI_CODEX_TRANSPORT_MONITOR = "PI_GUI_CODEX_TRANSPORT_MONITOR";
const PI_GUI_SERVICE_TIER_FILE = "PI_GUI_SERVICE_TIER_FILE";

export type PiExtensionIntegrationEnvOptions = {
  serviceTierConfigFile?: string;
  codexTransportMonitorEnabled?: boolean;
};

export function applyPiExtensionIntegrationEnv(env: NodeJS.ProcessEnv, options: PiExtensionIntegrationEnvOptions = {}): NodeJS.ProcessEnv {
  // GUI-owned integration toggles for bundled Pi extensions/shims. They are
  // launch-scoped env vars only; they must not mutate Pi/user configuration.
  env[PI_GUI_CODEX_TRANSPORT_MONITOR] = options.codexTransportMonitorEnabled ? "1" : "0";
  if (options.serviceTierConfigFile) env[PI_GUI_SERVICE_TIER_FILE] = options.serviceTierConfigFile;
  return env;
}

export function remotePiExtensionIntegrationEnvExports(): string[] {
  // Remote runtimes cannot receive local GUI extension files. Keep GUI-owned
  // integration env disabled unless a future remote-compatible adapter exists.
  return [`export ${PI_GUI_CODEX_TRANSPORT_MONITOR}=0`];
}
