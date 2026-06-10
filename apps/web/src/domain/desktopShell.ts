import type { PiPetDisplay } from "./piPet";

export type DesktopPetDisplayPayload = Pick<PiPetDisplay, "mood" | "tone" | "title" | "detail" | "badges" | "satelliteCount">;

export type DesktopShellBridge = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  setDesktopPetVisible?: (visible: boolean) => Promise<boolean>;
  updateDesktopPet?: (display: DesktopPetDisplayPayload) => Promise<boolean>;
  onDesktopPetClosed?: (callback: () => void) => () => void;
};

declare global {
  interface Window {
    __PI_GUI_DESKTOP__?: DesktopShellBridge;
  }
}

export function desktopShellBridge(): DesktopShellBridge | undefined {
  return typeof window === "undefined" ? undefined : window.__PI_GUI_DESKTOP__;
}
