import { useEffect, useMemo, useRef, useState } from "react";
import type { ConversationMessage, Project, Runtime, RuntimeConversationSummary } from "@pi-gui/shared";
import { completedAssistantReplyAt } from "./sidebarUnread";
import { normalizeProjectOrder, normalizeSessionOrderByProject, orderedById } from "./sidebarOrdering";

const PROJECT_ORDER_STORAGE_KEY = "pi-gui.projectOrder";
const SESSION_ORDER_STORAGE_KEY = "pi-gui.sessionOrder";
const COLLAPSED_PROJECTS_STORAGE_KEY = "pi-gui.collapsedProjects";
const RUNTIME_READ_TIMESTAMPS_STORAGE_KEY = "pi-gui.runtimeReadTimestamps";

type UseSidebarOrderingOptions = {
  projects: Project[];
  runtimes: Runtime[];
  activeRuntime?: Runtime;
  messagesByRuntime: Record<string, ConversationMessage[]>;
  conversationSummaries: Record<string, RuntimeConversationSummary>;
};

export function useSidebarOrdering({ projects, runtimes, activeRuntime, messagesByRuntime, conversationSummaries }: UseSidebarOrderingOptions) {
  const [collapsedProjectIds, setCollapsedProjectIds] = useState<Set<string>>(() => new Set(readStringArray(COLLAPSED_PROJECTS_STORAGE_KEY)));
  const [projectOrder, setProjectOrder] = useState<string[]>(() => readStringArray(PROJECT_ORDER_STORAGE_KEY));
  const [sessionOrderByProject, setSessionOrderByProject] = useState<Record<string, string[]>>(() => readStringArrayRecord(SESSION_ORDER_STORAGE_KEY));
  const [readTimestampsByRuntime, setReadTimestampsByRuntime] = useState<Record<string, number>>(() => readNumberRecord(RUNTIME_READ_TIMESTAMPS_STORAGE_KEY));
  const startupReadBaselineAppliedRef = useRef(false);

  useEffect(() => {
    setProjectOrder((current) => normalizeProjectOrder(current, projects.map((project) => project.id)));
  }, [projects]);

  useEffect(() => {
    writeStringArray(PROJECT_ORDER_STORAGE_KEY, projectOrder);
  }, [projectOrder]);

  useEffect(() => {
    setSessionOrderByProject((current) => {
      const runtimeIdsByProject = new Map<string, string[]>();
      for (const runtime of runtimes) {
        const ids = runtimeIdsByProject.get(runtime.projectId) ?? [];
        ids.push(runtime.id);
        runtimeIdsByProject.set(runtime.projectId, ids);
      }
      return normalizeSessionOrderByProject(current, projects.map((project) => project.id), runtimeIdsByProject);
    });
  }, [projects, runtimes]);

  useEffect(() => {
    writeStringArrayRecord(SESSION_ORDER_STORAGE_KEY, sessionOrderByProject);
  }, [sessionOrderByProject]);

  useEffect(() => {
    writeNumberRecord(RUNTIME_READ_TIMESTAMPS_STORAGE_KEY, readTimestampsByRuntime);
  }, [readTimestampsByRuntime]);

  useEffect(() => {
    const runtimeIds = new Set(runtimes.map((runtime) => runtime.id));
    setReadTimestampsByRuntime((current) => {
      const entries = Object.entries(current).filter(([runtimeId]) => runtimeIds.has(runtimeId));
      return entries.length === Object.keys(current).length ? current : Object.fromEntries(entries);
    });
  }, [runtimes]);

  useEffect(() => {
    writeStringArray(COLLAPSED_PROJECTS_STORAGE_KEY, [...collapsedProjectIds]);
  }, [collapsedProjectIds]);

  const orderedProjects = useMemo(() => orderedById(projects, projectOrder), [projectOrder, projects]);
  const activeRuntimeCompletedAt = activeRuntime ? completedAssistantReplyAt(conversationSummaries[activeRuntime.id], messagesByRuntime[activeRuntime.id]) : undefined;

  useEffect(() => {
    if (startupReadBaselineAppliedRef.current) return;
    if (runtimes.length === 0 && Object.keys(conversationSummaries).length === 0) return;

    const baselineReadTimestamps = new Map<string, number>();
    for (const runtime of runtimes) {
      if (runtime.archivedAt) continue;
      const completedAt = completedAssistantReplyAt(conversationSummaries[runtime.id], messagesByRuntime[runtime.id]);
      if (completedAt) baselineReadTimestamps.set(runtime.id, completedAt);
    }

    startupReadBaselineAppliedRef.current = true;
    if (baselineReadTimestamps.size === 0) return;

    setReadTimestampsByRuntime((current) => {
      let changed = false;
      const next = { ...current };
      for (const [runtimeId, completedAt] of baselineReadTimestamps) {
        if ((next[runtimeId] ?? 0) >= completedAt) continue;
        next[runtimeId] = completedAt;
        changed = true;
      }
      return changed ? next : current;
    });
  }, [runtimes, conversationSummaries, messagesByRuntime]);

  useEffect(() => {
    if (!activeRuntime || !activeRuntimeCompletedAt) return;
    markRuntimeConversationRead(activeRuntime.id, activeRuntimeCompletedAt);
  }, [activeRuntime?.id, activeRuntimeCompletedAt]);

  function toggleProjectCollapsed(projectId: string) {
    setCollapsedProjectIds((current) => {
      const next = new Set(current);
      if (next.has(projectId)) next.delete(projectId);
      else next.add(projectId);
      return next;
    });
  }

  function markRuntimeConversationRead(runtimeId: string, completedAt: number | undefined) {
    if (!completedAt) return;
    setReadTimestampsByRuntime((current) => {
      if ((current[runtimeId] ?? 0) >= completedAt) return current;
      return { ...current, [runtimeId]: Math.max(Date.now(), completedAt) };
    });
  }

  function orderedRuntimesForProject(projectId: string, projectRuntimes: Runtime[]): Runtime[] {
    return orderedById(projectRuntimes, sessionOrderByProject[projectId] ?? []);
  }

  return {
    collapsedProjectIds,
    orderedProjects,
    readTimestampsByRuntime,
    sessionOrderByProject,
    setProjectOrder,
    setSessionOrderByProject,
    toggleProjectCollapsed,
    markRuntimeConversationRead,
    orderedRuntimesForProject,
  };
}

function readStringArray(key: string): string[] {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return [];
    const parsed = JSON.parse(value) as unknown;
    return Array.isArray(parsed) ? parsed.filter((item): item is string => typeof item === "string") : [];
  } catch {
    return [];
  }
}

function readStringArrayRecord(key: string): Record<string, string[]> {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return {};
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([recordKey, recordValue]) => {
        if (!Array.isArray(recordValue)) return [];
        return [[recordKey, recordValue.filter((item): item is string => typeof item === "string")]];
      }),
    );
  } catch {
    return {};
  }
}

function readNumberRecord(key: string): Record<string, number> {
  try {
    const value = window.localStorage.getItem(key);
    if (!value) return {};
    const parsed = JSON.parse(value) as unknown;
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};

    return Object.fromEntries(
      Object.entries(parsed).flatMap(([recordKey, recordValue]) => {
        if (typeof recordValue !== "number" || !Number.isFinite(recordValue)) return [];
        return [[recordKey, recordValue]];
      }),
    );
  } catch {
    return {};
  }
}

function writeStringArray(key: string, value: string[]) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore unavailable localStorage; project ordering still works for the current page lifetime.
  }
}

function writeStringArrayRecord(key: string, value: Record<string, string[]>) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore unavailable localStorage; session ordering still works for the current page lifetime.
  }
}

function writeNumberRecord(key: string, value: Record<string, number>) {
  try {
    window.localStorage.setItem(key, JSON.stringify(value));
  } catch {
    // Ignore unavailable localStorage; unread state still works for the current page lifetime.
  }
}
