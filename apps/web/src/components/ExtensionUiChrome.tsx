import { extensionGoalWidgetView, isGoalChromeKey, type RuntimeExtensionUiChrome, type ExtensionUiWidget, type ExtensionUiWidgetPlacement } from "../domain/extensionUiChrome";

type ExtensionUiChromeProps = {
  chrome?: RuntimeExtensionUiChrome;
};

export function ExtensionUiStatusStrip({ chrome }: ExtensionUiChromeProps) {
  const statuses = Object.entries(chrome?.statuses ?? {}).sort(([left], [right]) => left.localeCompare(right));
  if (statuses.length === 0) return null;

  return (
    <div className="extension-ui-status-strip" aria-label="Extension status">
      {statuses.map(([key, text]) => (
        <span className={`extension-ui-status-chip ${isGoalChromeKey(key) ? "is-goal" : ""}`} key={key} title={text}>
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
        <ExtensionUiWidgetCard key={key} widgetKey={key} widget={widget} />
      ))}
    </div>
  );
}

function ExtensionUiWidgetCard({ widgetKey, widget }: { widgetKey: string; widget: ExtensionUiWidget }) {
  const goal = extensionGoalWidgetView(widgetKey, widget);
  if (goal) {
    return (
      <div className={`extension-ui-widget extension-ui-goal-widget status-${goal.status}`}>
        <div className="extension-ui-goal-title" title={goal.title}>{goal.title}</div>
        {goal.detail ? <div className="extension-ui-goal-detail" title={goal.detail}>{goal.detail}</div> : null}
        {widget.lines.map((line, index) => index > 0 && line !== goal.detail ? (
          <div className="extension-ui-widget-line" key={`${widgetKey}:${index}`} title={line}>
            {line}
          </div>
        ) : null)}
      </div>
    );
  }

  return (
    <div className="extension-ui-widget">
      {widget.lines.map((line, index) => (
        <div className="extension-ui-widget-line" key={`${widgetKey}:${index}`} title={line}>
          {line}
        </div>
      ))}
    </div>
  );
}
