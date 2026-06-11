import type { ExecutionHostRef, Project, Runtime } from "@pi-gui/shared";
import { executionHostLabel } from "../domain/executionHost";
import type { ConnectionState } from "../types";

type WorkbenchContextStripProps = {
  connection: ConnectionState;
  executionHost?: ExecutionHostRef;
  backendEndpoint?: string;
  selectedProject?: Project;
  activeRuntime?: Runtime;
  activeRuntimeIsBusy?: boolean;
  waitingForInput?: boolean;
};

export function WorkbenchContextStrip({
  connection,
  executionHost,
  backendEndpoint,
  selectedProject,
  activeRuntime,
  activeRuntimeIsBusy = false,
  waitingForInput = false,
}: WorkbenchContextStripProps) {
  return (
    <section className="workbench-context-strip" aria-label="Workbench context">
      <ContextPill label="Host" value={executionHostLabel(executionHost) ?? "Unknown host"} />
      <ContextPill label="Backend" value={safeBackendEndpoint(backendEndpoint) ?? "local backend"} />
      <ContextPill label="Project" value={selectedProject?.cwd ?? "No project selected"} wide />
      <ContextPill label="Runtime" value={runtimeDisplayStatus(connection, activeRuntime, activeRuntimeIsBusy, waitingForInput)} tone={runtimeTone(connection, activeRuntime)} />
    </section>
  );
}

function ContextPill({ label, value, wide = false, tone }: { label: string; value: string; wide?: boolean; tone?: "good" | "warn" | "danger" }) {
  return (
    <div className={`workbench-context-pill ${wide ? "wide" : ""} ${tone ? `tone-${tone}` : ""}`} title={`${label}: ${value}`}>
      <span>{label}</span>
      <strong>{value}</strong>
    </div>
  );
}

function safeBackendEndpoint(value: string | undefined): string | undefined {
  if (!value) return undefined;
  try {
    const url = new URL(value);
    return url.host || url.origin;
  } catch {
    return value.split(/[?#]/, 1)[0] || undefined;
  }
}

function runtimeDisplayStatus(connection: ConnectionState, runtime: Runtime | undefined, busy: boolean, waitingForInput: boolean): string {
  if (connection === "reconnecting" || connection === "degraded" || connection === "replaying") return "reconnecting";
  if (!runtime) return "no active runtime";
  if (runtime.status === "running" && waitingForInput) return "waiting input";
  if (runtime.status === "running") return busy ? "running busy" : "running idle";
  if (runtime.status === "starting") return "starting";
  return runtime.status;
}

function runtimeTone(connection: ConnectionState, runtime: Runtime | undefined): "good" | "warn" | "danger" | undefined {
  if (connection === "reconnecting" || connection === "degraded" || connection === "replaying") return "warn";
  if (runtime?.status === "crashed") return "danger";
  if (runtime?.status === "stopped") return "warn";
  if (runtime?.status === "running") return "good";
  return undefined;
}
