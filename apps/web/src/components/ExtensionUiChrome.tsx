import type { RuntimeExtensionUiChrome, ExtensionUiWidgetPlacement } from "../domain/extensionUiChrome";

type ExtensionUiChromeProps = {
  chrome?: RuntimeExtensionUiChrome;
};

export function ExtensionUiStatusStrip({ chrome }: ExtensionUiChromeProps) {
  const statuses = Object.entries(chrome?.statuses ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (statuses.length === 0) return null;

  return (
    <div className="extension-ui-status-strip" aria-label="Extension status">
      {statuses.map(([key, text]) => (
        <span className="extension-ui-status-chip" key={key} title={text}>
          {text}
        </span>
      ))}
    </div>
  );
}

export function ExtensionUiWidgetStack({ chrome, placement }: ExtensionUiChromeProps & { placement: ExtensionUiWidgetPlacement }) {
  const widgets = Object.entries(chrome?.widgets ?? {})
    .filter(([, widget]) => widget.placement === placement)
    .sort(([left], [right]) => left.localeCompare(right));
  if (widgets.length === 0) return null;

  return (
    <div className={`extension-ui-widget-stack placement-${placement}`} aria-live="polite">
      {widgets.map(([key, widget]) => (
        <div className="extension-ui-widget" key={key}>
          {widget.lines.map((line, index) => (
            <div className="extension-ui-widget-line" key={`${key}:${index}`} title={line}>
              {line}
            </div>
          ))}
        </div>
      ))}
    </div>
  );
}
