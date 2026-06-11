import type { SubagentChildRun, SubagentRun, SubagentToolTrace } from "@pi-gui/shared";

const MAX_RUN_FINAL_TEXT_CHARS = 12_000;
const MAX_CHILD_FINAL_TEXT_CHARS = 12_000;
const MAX_CHILD_TAIL_CHARS = 8_000;
const MAX_PROMPT_CHARS = 2_000;
const MAX_ACTIVITY_CHARS = 240;
const MAX_LAST_ACTION_CHARS = 240;
const MAX_PATH_CHARS = 2_000;
const MAX_ERROR_CHARS = 4_000;
const MAX_TOOL_ARGS_CHARS = 4_000;
const MAX_CHILD_RUNS = 20;
const MAX_TOOLS_PER_CHILD = 50;

export function subagentRunsForWire(runs: SubagentRun[]): SubagentRun[] {
  return runs.map(subagentRunForWire);
}

export function subagentRunForWire(run: SubagentRun): SubagentRun {
  return {
    ...run,
    finalText: truncateText(run.finalText, MAX_RUN_FINAL_TEXT_CHARS),
    errorMessage: truncateText(run.errorMessage, MAX_ERROR_CHARS),
    runs: trimChildRuns(run.runs),
  };
}

function trimChildRuns(runs: SubagentChildRun[]): SubagentChildRun[] {
  const visibleRuns = runs.length > MAX_CHILD_RUNS ? runs.slice(0, MAX_CHILD_RUNS) : runs;
  return visibleRuns.map((run) => ({
    ...run,
    prompt: truncateText(run.prompt, MAX_PROMPT_CHARS),
    traceFile: truncateText(run.traceFile, MAX_PATH_CHARS),
    activitySummary: truncateText(run.activitySummary, MAX_ACTIVITY_CHARS),
    lastAction: truncateText(run.lastAction, MAX_LAST_ACTION_CHARS),
    finalText: truncateText(run.finalText, MAX_CHILD_FINAL_TEXT_CHARS),
    textTail: truncateText(run.textTail, MAX_CHILD_TAIL_CHARS),
    thinkingTail: truncateText(run.thinkingTail, MAX_CHILD_TAIL_CHARS),
    stderrTail: truncateText(run.stderrTail, MAX_CHILD_TAIL_CHARS),
    errorMessage: truncateText(run.errorMessage, MAX_ERROR_CHARS),
    tools: trimTools(run.tools),
  }));
}

function trimTools(tools: SubagentToolTrace[] | undefined): SubagentToolTrace[] | undefined {
  if (!tools) return undefined;
  const visibleTools = tools.length > MAX_TOOLS_PER_CHILD ? tools.slice(-MAX_TOOLS_PER_CHILD) : tools;
  return visibleTools.map((tool) => ({
    ...tool,
    args: truncateText(tool.args, MAX_TOOL_ARGS_CHARS),
  }));
}

function truncateText(value: string | undefined, maxChars: number): string | undefined {
  if (value === undefined || value.length <= maxChars) return value;
  const omitted = value.length - maxChars;
  return `${value.slice(0, maxChars)}\n… [truncated ${omitted} chars; open sub-agent detail for full output]`;
}
