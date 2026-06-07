# Settings components

Feature-local components and hooks for the Settings surface.

- `SettingsPanel.tsx` remains the composition owner for settings data, local draft state, and callbacks from `App`.
- Files in this folder render focused settings sections or small settings-only helpers.
- Do not send WebSocket commands here; pass typed callback props from `SettingsPanel`/`App`.
- Keep backend/runtime truth in server events and `appReducer`; settings subcomponents may keep only local UI state such as disclosure/status-refresh state.
