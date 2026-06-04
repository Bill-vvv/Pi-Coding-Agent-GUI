import type { Dispatch } from "react";
import type { AppSettings, ModelSummary, ResponseMode, Runtime, ThinkingLevel } from "@pi-gui/shared";
import { modelKey } from "../domain/models";
import type { AppAction } from "../state/appReducer";
import type { GuiSocketSend } from "../types";

type UseModelRuntimeSettingsOptions = {
  models: ModelSummary[];
  settings: AppSettings;
  defaultModelKey: string;
  defaultThinkingLevel: ThinkingLevel;
  defaultResponseMode: ResponseMode;
  activeRuntime?: Runtime;
  responseMode: ResponseMode;
  dispatch: Dispatch<AppAction>;
  send: GuiSocketSend;
};

export function useModelRuntimeSettings({
  models,
  settings,
  defaultModelKey,
  defaultThinkingLevel,
  defaultResponseMode,
  activeRuntime,
  responseMode,
  dispatch,
  send,
}: UseModelRuntimeSettingsOptions) {
  function defaultRuntimeModelKey(): string | undefined {
    return defaultModelKey || settings.defaultModel;
  }

  function updateModelSettings(next: Partial<AppSettings>) {
    const merged: AppSettings = {
      ...settings,
      defaultModel: defaultModelKey || settings.defaultModel,
      defaultThinkingLevel,
      responseMode: defaultResponseMode,
      ...next,
    };
    send({ type: "settings.update", settings: merged });
  }

  function configureActiveRuntime(next: { model?: ModelSummary; thinkingLevel?: ThinkingLevel; responseMode?: ResponseMode }) {
    if (!activeRuntime) return;
    dispatch({
      type: "update.runtimeConfig",
      runtimeId: activeRuntime.id,
      model: next.model ? modelKey(next.model) : undefined,
      thinkingLevel: next.thinkingLevel,
      responseMode: next.responseMode,
    });
    send({
      type: "runtime.configure",
      runtimeId: activeRuntime.id,
      modelProvider: next.model?.provider,
      modelId: next.model?.id,
      thinkingLevel: next.thinkingLevel,
      responseMode: next.responseMode,
    });
  }

  function chooseModel(nextModel: ModelSummary) {
    const nextResponseMode = nextModel.supportsFast ? responseMode : "normal";
    dispatch({ type: "select.model", modelKey: modelKey(nextModel), responseMode: nextResponseMode });
    updateModelSettings({ defaultModel: modelKey(nextModel), responseMode: nextResponseMode });
    configureActiveRuntime({ model: nextModel, responseMode: nextResponseMode });
  }

  function chooseThinkingLevel(nextLevel: ThinkingLevel) {
    dispatch({ type: "select.thinkingLevel", thinkingLevel: nextLevel });
    updateModelSettings({ defaultThinkingLevel: nextLevel });
    configureActiveRuntime({ thinkingLevel: nextLevel });
  }

  function chooseResponseMode(nextMode: ResponseMode) {
    dispatch({ type: "select.responseMode", responseMode: nextMode });
    updateModelSettings({ responseMode: nextMode });
    configureActiveRuntime({ responseMode: nextMode });
  }

  return {
    defaultRuntimeModelKey,
    chooseModel,
    chooseThinkingLevel,
    chooseResponseMode,
  };
}
