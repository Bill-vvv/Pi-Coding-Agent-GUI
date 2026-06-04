export type ToolStatus = "running" | "completed" | "failed";

export function toolStatusLabel(status: ToolStatus): string {
  if (status === "running") return "运行中";
  if (status === "failed") return "失败";
  return "完成";
}
