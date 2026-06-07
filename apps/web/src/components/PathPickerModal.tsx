import type { DirectoryEntry, ResolvedPath } from "@pi-gui/shared";
import { useEffect, useState } from "react";
import { IconButton } from "./ui";

type PathPickerModalProps = {
  open: boolean;
  cwd: string;
  parent?: string;
  entries: DirectoryEntry[];
  loading: boolean;
  resolving: boolean;
  creatingDirectory: boolean;
  error?: string;
  manualPath: string;
  resolvedPath?: ResolvedPath;
  onManualPathChange: (path: string) => void;
  onResolveManualPath: (path?: string) => Promise<ResolvedPath | undefined>;
  onClose: () => void;
  onLoadDirectory: (path?: string) => void | Promise<void>;
  onChooseCurrentCwd: () => void | Promise<void>;
  onCreateDirectory: (name: string, parent?: string) => Promise<boolean>;
  title?: string;
  confirmLabel?: string;
  allowCreateFolder?: boolean;
};

export function PathPickerModal({
  open,
  cwd,
  parent,
  entries,
  loading,
  resolving,
  creatingDirectory,
  error,
  manualPath,
  resolvedPath,
  onManualPathChange,
  onResolveManualPath,
  onClose,
  onLoadDirectory,
  onChooseCurrentCwd,
  onCreateDirectory,
  title = "选择项目路径",
  confirmLabel = "使用当前目录",
  allowCreateFolder = false,
}: PathPickerModalProps) {
  const [showCreateFolder, setShowCreateFolder] = useState(false);
  const [folderName, setFolderName] = useState("");

  useEffect(() => {
    if (open && allowCreateFolder) return;
    setShowCreateFolder(false);
    setFolderName("");
  }, [allowCreateFolder, open]);

  if (!open) return null;

  const isRemoteProject = resolvedPath?.source === "ssh";

  async function handleCreateFolder() {
    const created = await onCreateDirectory(folderName, cwd);
    if (!created) return;
    setFolderName("");
    setShowCreateFolder(false);
  }

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="path-picker" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>{title}</h2>
            <p>{cwd || "正在读取目录..."}</p>
          </div>
          <IconButton icon="x" label="关闭" onClick={onClose} />
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="path-picker-manual">
          <label>
            <span>粘贴路径</span>
            <input
              value={manualPath}
              onChange={(event) => onManualPathChange(event.target.value)}
              placeholder="/home/me/project、C:\\Users\\me\\project、\\\\wsl.localhost\\Distro\\home\\me\\project 或 devbox:/srv/app"
            />
          </label>
          <button type="button" onClick={() => void onResolveManualPath()} disabled={resolving || loading || !manualPath.trim()}>
            {resolving ? "解析中…" : "解析路径"}
          </button>
        </div>

        {resolvedPath && (resolvedPath.source === "ssh" || resolvedPath.cwd !== resolvedPath.inputPath) ? (
          <p className={`path-picker-resolved ${resolvedPath.exists && resolvedPath.isDirectory ? "valid" : "invalid"}`}>
            {resolvedPath.source === "ssh" ? "SSH 远程项目" : "WSL 路径"}：<code>{resolvedPath.cwd}</code>
          </p>
        ) : null}

        <div className="path-picker-actions">
          <button type="button" onClick={() => parent && void onLoadDirectory(parent)} disabled={!parent || loading || isRemoteProject}>上一级</button>
          <button type="button" onClick={() => void onLoadDirectory(cwd)} disabled={!cwd || loading || isRemoteProject}>刷新</button>
          {allowCreateFolder ? (
            <button type="button" onClick={() => setShowCreateFolder((value) => !value)} disabled={!cwd || loading || resolving || creatingDirectory || isRemoteProject}>新建文件夹</button>
          ) : null}
          <button type="button" onClick={() => void onChooseCurrentCwd()} disabled={!cwd || loading || resolving || creatingDirectory}>{confirmLabel}</button>
        </div>

        {allowCreateFolder && showCreateFolder && !isRemoteProject ? (
          <div className="path-picker-create-folder">
            <label>
              <span>文件夹名称</span>
              <input
                value={folderName}
                onChange={(event) => setFolderName(event.target.value)}
                placeholder="new-project"
                disabled={creatingDirectory}
                onKeyDown={(event) => {
                  if (event.key === "Enter") void handleCreateFolder();
                }}
              />
            </label>
            <button type="button" onClick={() => void handleCreateFolder()} disabled={!folderName.trim() || !cwd || creatingDirectory || loading || resolving}>
              {creatingDirectory ? "创建中…" : "创建并进入"}
            </button>
          </div>
        ) : null}

        <div className="directory-list">
          {isRemoteProject ? <p className="muted">SSH 远程项目不会在本地浏览目录；确认后将在远端启动 Pi。</p> : null}
          {!isRemoteProject && loading ? <p className="muted">正在读取...</p> : null}
          {!isRemoteProject && !loading && entries.length === 0 ? <p className="muted">当前目录没有子目录。</p> : null}
          {!isRemoteProject
            ? entries.map((entry) => (
                <button className="directory-item" type="button" key={entry.path} onClick={() => void onLoadDirectory(entry.path)}>
                  <span>📁 {entry.name}</span>
                  <small>{entry.path}</small>
                </button>
              ))
            : null}
        </div>
      </section>
    </div>
  );
}
