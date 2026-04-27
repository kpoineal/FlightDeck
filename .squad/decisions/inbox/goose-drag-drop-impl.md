# Decision: Drag-and-Drop Event Syntax — Svelte 4 `on:` Style

**Date:** 2026-04-27
**Author:** Goose
**Context:** DEC-102 drag-and-drop implementation

## Decision

Used Svelte 4 `on:dragstart`/`on:drop` event syntax instead of Svelte 5 `ondragstart`/`ondrop` for all new drag-and-drop handlers.

## Rationale

The Svelte compiler enforces that a single component cannot mix legacy (`on:event`) and new (`onevent`) event handler syntax. All existing components in the codebase (TrackerCard, TrackerRow, ScannerSection) already use `on:click`, `on:change`, etc. throughout their templates.

Converting every existing handler in three components to Svelte 5 syntax would have been a high-risk, high-diff change with no functional benefit — and would create merge conflicts with any in-flight work touching those files.

## Implication

When the codebase eventually migrates to Svelte 5 event syntax, all `on:dragstart`/`on:drop`/`on:dragover`/`on:dragenter`/`on:dragleave`/`on:pointerenter`/`on:pointerleave` handlers in these three components should be converted alongside the existing handlers in a single pass.
