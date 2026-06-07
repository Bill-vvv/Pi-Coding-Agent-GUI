import { isRecord } from "@pi-gui/shared";
import { toolNameFromPayload } from "../conversation/piToolMessages.js";
import type { SubagentProgressAdapter } from "./subagentProgress.js";

const TRELLIS_SUBAGENT_TOOL = "trellis_subagent";
const TRELLIS_SUBAGENT_PROGRESS_KIND = "trellis-subagent-progress";

// Compatibility adapter for this repository's local Trellis/Pi extension
// progress format. This is not a universal Trellis or third-party subagent
// protocol; other providers should add their own adapter only when needed.
export const legacyTrellisSubagentAdapter: SubagentProgressAdapter = {
  id: "legacy-trellis-subagent",
  defaultAgent: "trellis-subagent",
  isRunToolPayload(payload) {
    return toolNameFromPayload(payload) === TRELLIS_SUBAGENT_TOOL;
  },
  progressDetails(value) {
    return isRecord(value) && value.kind === TRELLIS_SUBAGENT_PROGRESS_KIND ? value : undefined;
  },
};

export const defaultSubagentProgressAdapters: SubagentProgressAdapter[] = [legacyTrellisSubagentAdapter];
