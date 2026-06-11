export const CODEX_PET_COLUMNS = 8;
export const CODEX_PET_ROWS = 9;

export const CODEX_PET_ANIMATIONS = [
  "idle",
  "running-right",
  "running-left",
  "waving",
  "jumping",
  "failed",
  "waiting",
  "running",
  "review",
] as const;

export type CodexPetAnimationName = typeof CODEX_PET_ANIMATIONS[number];
export type DesktopPetStatus = "idle" | "running" | "waiting" | "review" | "done" | "failed" | "message";
export type DesktopPetPin = "bottom-right" | "bottom-left" | "top-right" | "top-left" | "free";

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

export type NormalizedDesktopPetDisplay = {
  mood: string;
  tone: string;
  status: DesktopPetStatus;
  animation: CodexPetAnimationName;
  title: string;
  detail: string;
  badges: string[];
  threadId: string;
  petId?: string;
};

export type CodexPetBundle = {
  id: string;
  displayName: string;
  description?: string;
  directory: string;
  spritesheetPath: string;
  spritesheetUrl: string;
  source: "bundled" | "codex" | "legacy";
  legacy?: boolean;
  warning?: string;
};

export type DesktopPetPreferences = {
  selectedPetId?: string;
  scale: number;
  position?: { x: number; y: number };
  pin: DesktopPetPin;
};

export type DesktopPetSnapshot = {
  display?: NormalizedDesktopPetDisplay;
  bundle: CodexPetBundle;
  preferences: DesktopPetPreferences;
};

export type DesktopPetListPayload = {
  pets: Array<Pick<CodexPetBundle, "id" | "displayName" | "description" | "source" | "legacy" | "warning">>;
  selectedPetId: string;
  scale: number;
};
