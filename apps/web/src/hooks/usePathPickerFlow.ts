import { useState, type Dispatch } from "react";
import type { AppAction } from "../state/appReducer";
import { usePathPicker } from "./usePathPicker";

type PathPickerMode = "composer" | "addProject";

type UsePathPickerFlowOptions = {
  projectCwd: string;
  createProjectOnly: (cwd: string) => boolean;
  dispatch: Dispatch<AppAction>;
};

export function usePathPickerFlow({ projectCwd, createProjectOnly, dispatch }: UsePathPickerFlowOptions) {
  const [pathPickerMode, setPathPickerMode] = useState<PathPickerMode>("composer");
  const pathPicker = usePathPicker();

  async function openPathPicker(mode: PathPickerMode = "composer") {
    setPathPickerMode(mode);
    await pathPicker.openPicker(projectCwd || undefined);
  }

  async function choosePickerCwd() {
    const cwd = await resolvedPickerCwd();
    if (!cwd) return;

    if (pathPickerMode === "addProject") {
      if (createProjectOnly(cwd)) pathPicker.closePicker();
      return;
    }

    dispatch({ type: "set.projectCwd", cwd });
    pathPicker.closePicker();
  }

  async function resolvedPickerCwd(): Promise<string | undefined> {
    const manual = pathPicker.manualPath.trim();
    if (manual && manual !== pathPicker.cwd) {
      const resolved = await pathPicker.resolveManualPath(manual);
      return resolved?.exists && resolved.isDirectory ? resolved.cwd : undefined;
    }
    return pathPicker.cwd;
  }

  return {
    pathPicker,
    pathPickerMode,
    openPathPicker,
    choosePickerCwd,
    title: pathPickerMode === "addProject" ? "添加项目" : "选择项目路径",
    confirmLabel: pathPickerMode === "addProject" ? "添加此项目" : "使用当前目录",
    allowCreateFolder: pathPickerMode === "addProject",
  };
}
