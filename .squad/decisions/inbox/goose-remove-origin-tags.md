# Decision: Remove Origin Tags from Tracking Cards

**Date**: 2026-03-12  
**Requested by**: the user  
**Agent**: Goose (Frontend Dev)

## Context

Tracking cards displayed origin tags ("Custom" or "Imported") as pill/badge elements in the card header to indicate whether an item was user-created or came from WorkIQ radar.

## Decision

the user decided that origin tags (custom/imported) are unnecessary clutter — they take up space in the card header without providing meaningful value to users.

## Action Taken

Removed origin tags entirely from tracking cards:
- Removed origin badge rendering from card templates
- Removed `ORIGIN_LABELS` constant definition
- Removed all `.origin-pill` CSS styles

## Impact

- Tracking cards now have cleaner, more focused headers with more space for actionable information
- The `origin` field still exists in tracking item data (for potential future use or export) but is no longer displayed in the UI
- No breaking changes — all tests pass
