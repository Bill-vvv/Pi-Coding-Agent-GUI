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

  function choosePickerCwd() {
    if (pathPickerMode === "addProject") {
      if (createProjectOnly(pathPicker.cwd)) pathPicker.closePicker();
      return;
    }

    dispatch({ type: "set.projectCwd", cwd: pathPicker.cwd });
    pathPicker.closePicker();
  }

  return {
    pathPicker,
    pathPickerMode,
    openPathPicker,
    choosePickerCwd,
    title: pathPickerMode === "addProject" ? "添加项目" : "选择项目路径",
    confirmLabel: pathPickerMode === "addProject" ? "添加此项目" : "使用当前目录",
  };
}
