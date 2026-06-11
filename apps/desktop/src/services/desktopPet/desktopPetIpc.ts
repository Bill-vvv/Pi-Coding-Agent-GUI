import type { IpcMain } from "electron";
import { desktopPetChannels } from "../../windowControls.js";
import type { DesktopPetWindowService } from "./desktopPetWindow.js";

export function registerDesktopPetIpc(ipcMain: IpcMain, service: DesktopPetWindowService): void {
  ipcMain.handle(desktopPetChannels.setVisible, (_event, visible: unknown) => service.setVisible(Boolean(visible)));
  ipcMain.handle(desktopPetChannels.update, (_event, payload: unknown) => service.updateDisplay(payload));
  ipcMain.handle(desktopPetChannels.list, () => service.listPets());
  ipcMain.handle(desktopPetChannels.select, (_event, petId: unknown) => typeof petId === "string" && service.selectPet(petId));
  ipcMain.handle(desktopPetChannels.setScale, (_event, scale: unknown) => service.setScale(scale));
  ipcMain.handle(desktopPetChannels.resetPosition, () => service.resetPosition());
}
