import type { ReactNode } from "react";
import { useEffect, useRef, useState } from "react";

type SettingsOption<T extends string> = { value: T; label: string; disabled?: boolean };

export function SettingsOptionGroup<T extends string>({
  name,
  label,
  options,
  value,
  onChange,
  variant = "radio",
  renderOptionVisual,
  labelHelp,
  describeOption,
}: {
  name: string;
  label: string;
  labelHelp?: string;
  options: ReadonlyArray<SettingsOption<T>>;
  value: T;
  onChange: (value: T) => void;
  variant?: "radio" | "dropdown";
  renderOptionVisual?: (option: SettingsOption<T>, currentValue: T) => ReactNode;
  describeOption?: (option: SettingsOption<T>, currentValue: T) => string | undefined;
}) {
  const fieldName = `settings-${name}`;
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const selectedOption = options.find((option) => option.value === value);

  useEffect(() => {
    if (!open) return;

    function handlePointerDown(event: PointerEvent) {
      const target = event.target;
      if (target instanceof Node && rootRef.current?.contains(target)) return;
      setOpen(false);
    }

    function handleKeyDown(event: KeyboardEvent) {
      if (event.key === "Escape") setOpen(false);
    }

    document.addEventListener("pointerdown", handlePointerDown);
    document.addEventListener("keydown", handleKeyDown);
    return () => {
      document.removeEventListener("pointerdown", handlePointerDown);
      document.removeEventListener("keydown", handleKeyDown);
    };
  }, [open]);

  if (variant === "dropdown") {
    return (
      <div className="settings-field settings-dropdown-field" ref={rootRef}>
        <span className="settings-field-label settings-label-with-help" id={`${fieldName}-label`}>
          <span>{label}</span>
          {labelHelp ? <span className="settings-help-dot" title={labelHelp} aria-label={labelHelp}>?</span> : null}
        </span>
        <span className="settings-dropdown-control">
          <button
            className="settings-dropdown-trigger"
            type="button"
            id={`${fieldName}-trigger`}
            aria-haspopup="menu"
            aria-expanded={open}
            aria-labelledby={`${fieldName}-label ${fieldName}-trigger`}
            onClick={() => setOpen((current) => !current)}
          >
            <span>{selectedOption?.label ?? value}</span>
            <span className="settings-dropdown-chevron" aria-hidden="true">⌄</span>
          </button>

          {open ? (
            <div className="settings-dropdown-menu" role="menu" aria-labelledby={`${fieldName}-label`}>
              {options.map((option) => {
                const description = describeOption?.(option, value);
                const visual = renderOptionVisual?.(option, value);
                return (
                  <button
                    className={`settings-dropdown-option ${value === option.value ? "selected" : ""}`}
                    type="button"
                    role="menuitemradio"
                    aria-checked={value === option.value}
                    disabled={option.disabled}
                    key={option.value}
                    onClick={() => {
                      onChange(option.value);
                      setOpen(false);
                    }}
                  >
                    {visual ? <span className="settings-dropdown-option-visual" aria-hidden="true">{visual}</span> : null}
                    <span className="settings-dropdown-option-copy">
                      <span>{option.label}</span>
                      {description ? <small>{description}</small> : null}
                    </span>
                  </button>
                );
              })}
            </div>
          ) : null}
        </span>
      </div>
    );
  }

  return (
    <div className="settings-field">
      <label className="settings-label-with-help">
        <span>{label}</span>
        {labelHelp ? <span className="settings-help-dot" title={labelHelp} aria-label={labelHelp}>?</span> : null}
      </label>
      <div className="settings-radio-options" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <label className={`settings-radio-option ${value === option.value ? "selected" : ""} ${option.disabled ? "disabled" : ""}`} key={option.value}>
            <input
              type="radio"
              name={fieldName}
              value={option.value}
              checked={value === option.value}
              disabled={option.disabled}
              onChange={() => onChange(option.value)}
            />
            <span>{option.label}</span>
          </label>
        ))}
      </div>
    </div>
  );
}
