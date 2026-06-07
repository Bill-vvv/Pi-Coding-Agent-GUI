import type { ComposerCompletionItem } from "../../domain/composerCommands";

type ComposerCommandMenuProps = {
  items: ComposerCompletionItem[];
  activeIndex: number;
  onActivate: (index: number) => void;
  onSelect: (item: ComposerCompletionItem) => void;
};

export function ComposerCommandMenu({ items, activeIndex, onActivate, onSelect }: ComposerCommandMenuProps) {
  return (
    <div className="composer-command-menu" role="listbox" aria-label="Pi slash commands">
      {items.map((item, index) => (
        <button
          key={item.key}
          className={`composer-command-item ${index === activeIndex ? "is-active" : ""}`}
          type="button"
          role="option"
          aria-selected={index === activeIndex}
          onMouseDown={(event) => event.preventDefault()}
          onMouseEnter={() => onActivate(index)}
          onClick={() => onSelect(item)}
        >
          <span className="composer-command-name">{item.title}</span>
          <span className="composer-command-description">{item.description}</span>
          <span className={`composer-command-source source-${item.kind}`}>{item.sourceLabel}</span>
        </button>
      ))}
    </div>
  );
}
