import type { CodexPetAnimationName, DesktopPetStatus, PiPetDisplay } from "./piPet";

export type DesktopPetDisplayPayload = Pick<PiPetDisplay, "mood" | "tone" | "title" | "detail" | "badges" | "satelliteCount"> & {
  status: DesktopPetStatus;
  animation: CodexPetAnimationName;
  threadId?: string;
  petId?: string;
  scale?: number;
};

export type DesktopPetListPayload = {
  pets: Array<{
    id: string;
    displayName: string;
    description?: string;
    source: "bundled" | "codex" | "legacy";
    legacy?: boolean;
    warning?: string;
  }>;
  selectedPetId: string;
  scale: number;
};

export type DesktopShellBridge = {
  minimize: () => Promise<void>;
  toggleMaximize: () => Promise<void>;
  close: () => Promise<void>;
  isMaximized: () => Promise<boolean>;
  onMaximizedChange: (callback: (maximized: boolean) => void) => () => void;
  setDesktopPetVisible?: (visible: boolean) => Promise<boolean>;
  updateDesktopPet?: (display: DesktopPetDisplayPayload) => Promise<boolean>;
  listDesktopPets?: () => Promise<DesktopPetListPayload>;
  setDesktopPetSelection?: (petId: string) => Promise<boolean>;
  setDesktopPetScale?: (scale: number) => Promise<boolean>;
  resetDesktopPetPosition?: () => Promise<boolean>;
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
