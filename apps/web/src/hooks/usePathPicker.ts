import { useState } from "react";
import type { DirectoryEntry } from "../types";

export function usePathPicker() {
  const [open, setOpen] = useState(false);
  const [cwd, setCwd] = useState("");
  const [parent, setParent] = useState<string | undefined>();
  const [entries, setEntries] = useState<DirectoryEntry[]>([]);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | undefined>();

  async function loadDirectory(path?: string) {
    setLoading(true);
    setError(undefined);
    try {
      const query = path ? `?path=${encodeURIComponent(path)}` : "";
      const response = await fetch(`/api/fs/list${query}`);
      if (!response.ok) throw new Error(await response.text());
      const data = (await response.json()) as { cwd: string; parent?: string; entries: DirectoryEntry[] };
      setCwd(data.cwd);
      setParent(data.parent);
      setEntries(data.entries);
    } catch (error) {
      setError((error as Error).message || "读取目录失败");
    } finally {
      setLoading(false);
    }
  }

  async function openPicker(path?: string) {
    setOpen(true);
    await loadDirectory(path);
  }

  function closePicker() {
    setOpen(false);
  }

  return {
    open,
    cwd,
    parent,
    entries,
    loading,
    error,
    openPicker,
    closePicker,
    loadDirectory,
  };
}
