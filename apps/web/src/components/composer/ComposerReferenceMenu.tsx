import type { ComposerFileSearchEntry } from "../../domain/composerReferences";

type ComposerReferenceMenuProps = {
  items: ComposerFileSearchEntry[];
  activeIndex: number;
  onActivate: (index: number) => void;
  onSelect: (item: ComposerFileSearchEntry) => void;
};

export function ComposerReferenceMenu({ items, activeIndex, onActivate, onSelect }: ComposerReferenceMenuProps) {
  if (items.length === 0) return null;
  return (
    <div className="command-menu reference-menu" role="listbox" aria-label="文件引用补全">
      {items.map((item, index) => (
        <button
          className={`command-menu-item ${index === activeIndex ? "selected" : ""}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          key={item.path}
          onMouseEnter={() => onActivate(index)}
          onClick={() => onSelect(item)}
        >
          <span className="command-menu-title">@{item.relativePath}</span>
          <span className="command-menu-description">{item.type === "directory" ? "目录" : "文件"}</span>
        </button>
      ))}
    </div>
  );
}
