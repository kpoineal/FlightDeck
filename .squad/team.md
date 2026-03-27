# FlightDeck — Squad Team

## Project Context

- **Project:** FlightDeck — personal work radar for Microsoft 365 signals
- **Stack:** Electron, vanilla JavaScript, node-pty, IPC
- **User:** the project owner
- **Description:** FlightDeck scans Microsoft 365 signals (email, Teams, meetings, documents) to surface what needs attention, classified by priority. It tracks individual items over time with automated monitoring that checks for new activity on a schedule.

## Members

| Name | Role | Model | Badge |
|------|------|-------|-------|
| Maverick | Lead | gpt-5.3-codex | 🏗️ Lead |
| Goose | Frontend Dev | gemini-3-pro-preview | ⚛️ Frontend |
| Viper | Backend Dev | claude-opus-4.6-fast | 🔧 Backend |
| Merlin | Tester | claude-opus-4.6-fast | 🧪 Tester |
| Jester | DevOps Engineer | claude-opus-4.6-fast | ⚙️ DevOps |
| Iceman | Product Owner | claude-opus-4.6-fast | 🎯 Product |
| Charlie | Prompt Engineer | claude-sonnet-4.5 | ✨ Prompt |
| Scribe | Session Logger | claude-haiku-4.5 | 📋 Scribe |
| Ralph | Work Monitor | — | 🔄 Monitor |

## Architecture Notes

- **main.js** (583 lines) — Electron main process: window management, IPC handlers, node-pty process management, tray, notifications
- **renderer.js** (5,355 lines) — All frontend logic in a single file: theme, UI state, radar view, tracking view, briefings, history, search, scheduling, localStorage persistence
- **index.html** (2,145 lines) — Full UI markup + inline CSS theme tokens
- **preload.js** — IPC bridge via contextBridge
- **prompts/** — Markdown prompt templates for AI briefing/scanning

## Refactoring Goals

- Break monolithic files into modular components
- Separate concerns (UI rendering, state management, IPC communication, business logic)
- Add test coverage to prevent regressions during refactoring
- Improve maintainability and developer experience
