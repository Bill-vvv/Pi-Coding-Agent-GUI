import { contextBridge, ipcRenderer } from "electron";
import type { RendererRuntimeConfig } from "./desktopConfig.js";
import { desktopHostChannels, desktopPetChannels, rendererConfigChannels, windowControlChannels, type DesktopPetDisplayPayload, type WindowStatePayload } from "./windowControls.js";

const transparentWindow = process.argv.includes("--pi-gui-transparent-window=1");
if (transparentWindow) {
  document.documentElement.dataset.piGuiTransparentWindow = "true";
}

const config = ipcRenderer.sendSync(rendererConfigChannels.get) as RendererRuntimeConfig | undefined;

if (config) {
  contextBridge.exposeInMainWorld("__PI_GUI_CONFIG__", config);
}

contextBridge.exposeInMainWorld("__PI_GUI_DESKTOP__", {
  minimize: () => ipcRenderer.invoke(windowControlChannels.minimize),
  toggleMaximize: () => ipcRenderer.invoke(windowControlChannels.toggleMaximize),
  close: () => ipcRenderer.invoke(windowControlChannels.close),
  isMaximized: () => ipcRenderer.invoke(windowControlChannels.isMaximized),
  onMaximizedChange: (callback: (maximized: boolean) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: WindowStatePayload) => callback(payload.maximized);
    ipcRenderer.on(windowControlChannels.stateChanged, listener);
    return () => ipcRenderer.removeListener(windowControlChannels.stateChanged, listener);
  },
  selectBackendHost: (kind: "wsl" | "windows") => ipcRenderer.invoke(desktopHostChannels.select, kind),
  setDesktopPetVisible: (visible: boolean) => ipcRenderer.invoke(desktopPetChannels.setVisible, visible),
  updateDesktopPet: (display: DesktopPetDisplayPayload) => ipcRenderer.invoke(desktopPetChannels.update, display),
  onDesktopPetDisplay: (callback: (display: DesktopPetDisplayPayload) => void) => {
    const listener = (_event: Electron.IpcRendererEvent, payload: DesktopPetDisplayPayload) => callback(payload);
    ipcRenderer.on(desktopPetChannels.updated, listener);
    return () => ipcRenderer.removeListener(desktopPetChannels.updated, listener);
  },
  onDesktopPetClosed: (callback: () => void) => {
    const listener = () => callback();
    ipcRenderer.on(desktopPetChannels.closed, listener);
    return () => ipcRenderer.removeListener(desktopPetChannels.closed, listener);
  },
});
