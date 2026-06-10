import { useEffect, useState } from "react";
import type { DesktopShellBridge } from "../domain/desktopShell";

type DesktopWindowChromeProps = {
  bridge: DesktopShellBridge;
};

export function DesktopWindowChrome({ bridge }: DesktopWindowChromeProps) {
  const [maximized, setMaximized] = useState(false);

  useEffect(() => {
    let mounted = true;
    void bridge.isMaximized().then((value) => {
      if (mounted) setMaximized(value);
    });
    const unsubscribe = bridge.onMaximizedChange(setMaximized);
    return () => {
      mounted = false;
      unsubscribe();
    };
  }, [bridge]);

  return (
    <header className="desktop-window-chrome" aria-label="Pi GUI desktop window controls">
      <div className="desktop-window-drag-region">
        <span className="desktop-window-title">Pi GUI</span>
        <span className="desktop-window-chip">Desktop</span>
      </div>
      <div className="desktop-window-controls">
        <button className="desktop-window-control minimize" type="button" aria-label="最小化窗口" title="最小化" onClick={() => void bridge.minimize()}>
          <span aria-hidden="true" />
        </button>
        <button
          className={`desktop-window-control ${maximized ? "restore" : "maximize"}`}
          type="button"
          aria-label={maximized ? "还原窗口" : "最大化窗口"}
          title={maximized ? "还原" : "最大化"}
          onClick={() => void bridge.toggleMaximize()}
        >
          <span aria-hidden="true" />
        </button>
        <button className="desktop-window-control close" type="button" aria-label="关闭窗口" title="关闭" onClick={() => void bridge.close()}>
          <span aria-hidden="true" />
        </button>
      </div>
    </header>
  );
}
