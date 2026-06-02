import type { FormEventHandler } from "react";
import type { ModelSummary, Project, ResponseMode, Runtime, ThinkingLevel } from "@pi-gui/shared";
import type { ConnectionState } from "../types";
import { Icon } from "./Icon";
import { ModelPicker } from "./ModelPicker";

type ComposerProps = {
  prompt: string;
  projectCwd: string;
  selectedProject?: Project;
  models: ModelSummary[];
  selectedModel?: ModelSummary;
  selectedThinkingLevel: ThinkingLevel;
  availableThinkingLevels: ThinkingLevel[];
  responseMode: ResponseMode;
  modelPickerOpen: boolean;
  connection: ConnectionState;
  activeRuntime?: Runtime;
  activeRuntimeIsBusy: boolean;
  onSubmit: FormEventHandler<HTMLFormElement>;
  onPromptChange: (prompt: string) => void;
  onOpenPathPicker: () => void | Promise<void>;
  onAbortRuntime: (runtimeId: string) => void;
  onToggleModelPicker: () => void;
  onChooseModel: (model: ModelSummary) => void;
  onChooseThinkingLevel: (level: ThinkingLevel) => void;
  onChooseResponseMode: (mode: ResponseMode) => void;
};

export function Composer({
  prompt,
  projectCwd,
  selectedProject,
  models,
  selectedModel,
  selectedThinkingLevel,
  availableThinkingLevels,
  responseMode,
  modelPickerOpen,
  connection,
  activeRuntime,
  activeRuntimeIsBusy,
  onSubmit,
  onPromptChange,
  onOpenPathPicker,
  onAbortRuntime,
  onToggleModelPicker,
  onChooseModel,
  onChooseThinkingLevel,
  onChooseResponseMode,
}: ComposerProps) {
  return (
    <form className="composer" onSubmit={onSubmit}>
      <div className="composer-input-row">
        <textarea
          value={prompt}
          onChange={(event) => onPromptChange(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey && !event.nativeEvent.isComposing) {
              event.preventDefault();
              event.currentTarget.form?.requestSubmit();
            }
          }}
          placeholder="向当前对话发送提示词，Shift+Enter 换行"
        />
        <button
          className="composer-action send-action"
          type="submit"
          title="发送"
          aria-label="发送"
          disabled={!prompt.trim() || connection !== "open"}
        >
          <Icon name="send" />
        </button>
        {activeRuntime?.status === "running" && activeRuntimeIsBusy ? (
          <button
            className="composer-action abort-action"
            type="button"
            title="中止本轮输出"
            aria-label="中止本轮输出"
            onClick={() => onAbortRuntime(activeRuntime.id)}
          >
            <Icon name="stop" />
          </button>
        ) : null}
      </div>

      <div className="composer-meta-row">
        <button className={`path-picker-trigger composer-project-trigger ${projectCwd || selectedProject ? "has-value" : ""}`} type="button" onClick={() => void onOpenPathPicker()}>
          <Icon name="folder" />
          <span>{projectCwd || selectedProject?.cwd || "选择项目文件夹"}</span>
        </button>

        <ModelPicker
          models={models}
          selectedModel={selectedModel}
          selectedThinkingLevel={selectedThinkingLevel}
          availableThinkingLevels={availableThinkingLevels}
          responseMode={responseMode}
          open={modelPickerOpen}
          onToggleOpen={onToggleModelPicker}
          onChooseModel={onChooseModel}
          onChooseThinkingLevel={onChooseThinkingLevel}
          onChooseResponseMode={onChooseResponseMode}
        />
      </div>
    </form>
  );
}
