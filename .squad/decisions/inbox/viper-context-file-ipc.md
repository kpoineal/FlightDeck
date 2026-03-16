# Decision: OneDrive Context File IPC Channels

**Date:** 2026-03-06
**Author:** Viper (Backend Dev)
**Status:** Implemented

## Context

FlightDeck needs to write a `context.md` file to the user's corporate OneDrive so that external tools (e.g., AI assistants, meeting prep flows) can read current FlightDeck state as ambient context. This requires IPC plumbing from the renderer → main process, since filesystem writes must happen in the privileged main process.

## Decision

Add two IPC channels to the existing contract:

| Channel | Direction | Purpose |
|---|---|---|
| `write-context-file` | renderer → main (handle) | Write string content to `%OneDriveCommercial%\FlightInfo\context.md` |
| `get-context-file-path` | renderer → main (handle) | Return the resolved path string, or `null` if env var unset |

## Rationale

- **OneDriveCommercial** is the correct Windows env var for corporate/M365-linked OneDrive (vs `OneDrive` which is personal). Using it as the base ensures the file lands in the synced corporate directory on all dev/user machines.
- **`FlightInfo/` subdirectory** provides a clean namespace under OneDrive root — avoids polluting the OneDrive root level.
- **Structured return values** (`{ success, path }` / `{ success, error }`) follow the established pattern in this codebase for all IPC handlers that perform I/O with failure modes.
- **`mkdirSync({ recursive: true })`** before every write is safe and idempotent — no separate existence check needed.
- **`null` return on missing env var** (rather than error) for `GET_CONTEXT_FILE_PATH` — the renderer uses this for display purposes only; a null is easier to gate on than catching a thrown error.

## Files Changed

- `src/shared/ipc-contract.js` — canonical channel constant definitions
- `src/main/ipc-handlers.js` — `ipcMain.handle()` registrations
- `src/preload.js` — local `IPC_CHANNELS` mirror + `contextBridge` method exposure

## Validation

430/430 tests pass. No existing handlers modified.

## Notes for Goose

The renderer can now call:
```js
await window.workiq.writeContextFile(markdownString);
await window.workiq.getContextFilePath();
```
The write returns `{ success: true, path: '...' }` on success or `{ success: false, error: '...' }` on failure (including missing env var).
