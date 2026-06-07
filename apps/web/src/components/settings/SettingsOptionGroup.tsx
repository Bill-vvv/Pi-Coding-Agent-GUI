export function SettingsOptionGroup<T extends string>({
  name,
  label,
  options,
  value,
  onChange,
}: {
  name: string;
  label: string;
  options: Array<{ value: T; label: string; disabled?: boolean }>;
  value: T;
  onChange: (value: T) => void;
}) {
  return (
    <div className="settings-field">
      <label>{label}</label>
      <div className="settings-radio-options" role="radiogroup" aria-label={label}>
        {options.map((option) => (
          <label className={`settings-radio-option ${value === option.value ? "selected" : ""} ${option.disabled ? "disabled" : ""}`} key={option.value}>
            <input
              type="radio"
              name={`settings-${name}`}
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
