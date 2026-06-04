import type { DirectoryEntry } from "../types";
import { Icon } from "./Icon";

type PathPickerModalProps = {
  open: boolean;
  cwd: string;
  parent?: string;
  entries: DirectoryEntry[];
  loading: boolean;
  error?: string;
  onClose: () => void;
  onLoadDirectory: (path?: string) => void | Promise<void>;
  onChooseCurrentCwd: () => void;
  title?: string;
  confirmLabel?: string;
};

export function PathPickerModal({
  open,
  cwd,
  parent,
  entries,
  loading,
  error,
  onClose,
  onLoadDirectory,
  onChooseCurrentCwd,
  title = "选择项目路径",
  confirmLabel = "使用当前目录",
}: PathPickerModalProps) {
  if (!open) return null;

  return (
    <div className="modal-backdrop" role="presentation" onMouseDown={onClose}>
      <section className="path-picker" role="dialog" aria-modal="true" aria-label={title} onMouseDown={(event) => event.stopPropagation()}>
        <header>
          <div>
            <h2>{title}</h2>
            <p>{cwd || "正在读取目录..."}</p>
          </div>
          <button className="icon-button" type="button" title="关闭" aria-label="关闭" onClick={onClose}>
            <Icon name="x" />
          </button>
        </header>

        {error ? <div className="error-banner">{error}</div> : null}

        <div className="path-picker-actions">
          <button type="button" onClick={() => parent && void onLoadDirectory(parent)} disabled={!parent || loading}>上一级</button>
          <button type="button" onClick={() => void onLoadDirectory(cwd)} disabled={!cwd || loading}>刷新</button>
          <button type="button" onClick={onChooseCurrentCwd} disabled={!cwd}>{confirmLabel}</button>
        </div>

        <div className="directory-list">
          {loading ? <p className="muted">正在读取...</p> : null}
          {!loading && entries.length === 0 ? <p className="muted">当前目录没有子目录。</p> : null}
          {entries.map((entry) => (
            <button className="directory-item" type="button" key={entry.path} onClick={() => void onLoadDirectory(entry.path)}>
              <span>📁 {entry.name}</span>
              <small>{entry.path}</small>
            </button>
          ))}
        </div>
      </section>
    </div>
  );
}
