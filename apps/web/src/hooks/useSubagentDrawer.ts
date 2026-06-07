import { useCallback, useEffect, useState } from "react";
import type { SubagentRun } from "@pi-gui/shared";
import { subagentCopyText, subagentDetailKey, subagentRunIsActive } from "../domain/subagents";
import type { AppAction, AppState } from "../state/appReducer";
import type { GuiSocketSend } from "../types";

type SubagentDrawerSelection = { runId: string; childRunId?: string };

type UseSubagentDrawerOptions = {
  subagentRuns: AppState["subagentRuns"];
  subagentDetails: AppState["subagentDetails"];
  send: GuiSocketSend;
  dispatch: (action: AppAction) => void;
};

export function useSubagentDrawer({ subagentRuns, subagentDetails, send, dispatch }: UseSubagentDrawerOptions) {
  const [subagentDrawer, setSubagentDrawer] = useState<SubagentDrawerSelection | undefined>();
  const selectedSubagentRun = subagentDrawer ? subagentRuns[subagentDrawer.runId] : undefined;
  const selectedSubagentChildRunId = selectedSubagentRun ? subagentDrawer?.childRunId ?? selectedSubagentRun.runs[0]?.id : undefined;
  const selectedSubagentDetail = selectedSubagentRun && selectedSubagentChildRunId ? subagentDetails[subagentDetailKey(selectedSubagentRun.id, selectedSubagentChildRunId)] : undefined;
  const selectedSubagentRunIsActive = selectedSubagentRun ? subagentRunIsActive(selectedSubagentRun) : false;

  const requestSubagentDetail = useCallback(
    (runId: string, childRunId?: string) => {
      send({ type: "subagent.detail.open", runId, childRunId, limit: 240 }, { notifyOnDisconnected: false });
    },
    [send],
  );

  useEffect(() => {
    if (!selectedSubagentRun || !selectedSubagentChildRunId) return;
    requestSubagentDetail(selectedSubagentRun.id, selectedSubagentChildRunId);
    if (!selectedSubagentRunIsActive) return;
    const timer = window.setInterval(() => requestSubagentDetail(selectedSubagentRun.id, selectedSubagentChildRunId), 1600);
    return () => window.clearInterval(timer);
  }, [selectedSubagentRun?.id, selectedSubagentRunIsActive, selectedSubagentChildRunId, requestSubagentDetail]);

  const openSubagentRun = useCallback((runId: string) => setSubagentDrawer({ runId }), []);
  const closeSubagentDrawer = useCallback(() => setSubagentDrawer(undefined), []);
  const selectSubagentChildRun = useCallback((childRunId: string) => {
    if (!selectedSubagentRun) return;
    setSubagentDrawer({ runId: selectedSubagentRun.id, childRunId });
  }, [selectedSubagentRun]);

  const copySubagentOutput = useCallback((run: SubagentRun) => {
    const text = subagentCopyText(run);
    if (!text) return;
    void navigator.clipboard.writeText(text).then(
      () => dispatch({ type: "set.notice", notice: "已复制子代理结果" }),
      () => dispatch({ type: "set.operationError", error: "复制子代理结果失败" }),
    );
  }, [dispatch]);

  return {
    selectedSubagentRun,
    selectedSubagentChildRunId,
    selectedSubagentDetail,
    openSubagentRun,
    closeSubagentDrawer,
    selectSubagentChildRun,
    copySubagentOutput,
  };
}
