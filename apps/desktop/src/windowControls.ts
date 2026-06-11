export const windowControlChannels = {
  minimize: "pi-gui.window.minimize",
  toggleMaximize: "pi-gui.window.toggle-maximize",
  close: "pi-gui.window.close",
  isMaximized: "pi-gui.window.is-maximized",
  stateChanged: "pi-gui.window.state-changed",
} as const;

export const desktopHostChannels = {
  select: "pi-gui.desktop-host.select",
} as const;

export const rendererConfigChannels = {
  get: "pi-gui.renderer-config.get",
} as const;

export const desktopPetChannels = {
  setVisible: "pi-gui.desktop-pet.set-visible",
  update: "pi-gui.desktop-pet.update",
  updated: "pi-gui.desktop-pet.updated",
  closed: "pi-gui.desktop-pet.closed",
  list: "pi-gui.desktop-pet.list",
  select: "pi-gui.desktop-pet.select",
  setScale: "pi-gui.desktop-pet.set-scale",
  resetPosition: "pi-gui.desktop-pet.reset-position",
} as const;

export type WindowStatePayload = {
  maximized: boolean;
};

export type DesktopPetDisplayPayload = {
  mood?: string;
  tone?: string;
  status?: string;
  animation?: string;
  title: string;
  detail: string;
  badges: string[];
  satelliteCount?: number;
  threadId?: string;
  petId?: string;
  scale?: number;
  skin?: string;
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
