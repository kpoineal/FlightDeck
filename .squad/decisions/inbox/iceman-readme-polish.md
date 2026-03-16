# Decision: README.md Professional Rewrite

**Author:** Iceman (Product Owner) | **Date:** 2026-03-16 | **Status:** Implemented | **Requested by:** Kyle Poineal

## Summary

Rewrote README.md from a functional-but-rough project doc into a polished, professional open-source README following best-in-class GitHub patterns. Also updated `package.json` description to match.

## Key Decisions

1. **Centered logo + badges header** — Uses `src/icon.png` with HTML centering. Shield badges for License (TBD), Node.js 18+, Electron 35+, build status, and Changelog link.

2. **Elevator pitch over Problem/Solution** — Replaced the verbose two-section Problem/Solution with a single compelling paragraph. The value prop is clear in 3 seconds.

3. **GitHub markdown features** — Leveraged callout blocks (`> [!WARNING]`, `> [!NOTE]`, `> [!TIP]`, `> [!IMPORTANT]`), collapsible `<details>` sections (project tree, test coverage, tracker creation), clean tables, and anchor-linked TOC.

4. **"What's New" folded into badge** — Standalone section removed. Changelog shield badge in header links to CHANGELOG.md. Release workflow details are in CONTRIBUTING.md where they belong.

5. **Tech Stack version corrected** — Electron version updated from "33+" to "35+" to match actual `package.json` dependency (`^35.7.5`).

6. **package.json description updated** — Changed from "Simple POC to call workiq CLI from Electron" to "Air traffic control for your Microsoft 365 workload". This propagates to npm, GitHub repo description, and electron-builder metadata.

7. **Contributing section added** — Brief welcoming paragraph linking to CONTRIBUTING.md. Standard open-source pattern.

## What Was Preserved

All existing content topics retained: SmartScreen/code-signing warnings, Enable WorkIQ flow, mermaid architecture diagram, all three screenshots with original paths and alt text, monitoring engine explanation, state persistence table, security section, project structure tree, prerequisites table, tech stack table, deployment options.

## Rationale

The README is the front door of any open-source project. The previous version read like internal documentation for a POC. For FlightDeck to be taken seriously as a tool others might use or contribute to, it needs to look and read like a product — not a prototype.
