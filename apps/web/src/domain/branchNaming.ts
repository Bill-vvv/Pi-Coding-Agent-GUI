export type BranchType = "feat" | "fix" | "chore" | "refactor";

export function generateBranchName(type: BranchType, title: string): string {
  const slug = slugifyBranchTitle(title);
  return `${type}/${slug || "workbench-change"}`;
}

export function slugifyBranchTitle(title: string): string {
  return title
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "")
    .replace(/-{2,}/g, "-")
    .slice(0, 72);
}
