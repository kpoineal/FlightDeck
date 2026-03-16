# Decision: Tracking Item Inline Editing

**Date:** 2026-03-12  
**Author:** Goose (Frontend Dev)  
**Status:** Implemented  

## Context

Users need to quickly edit key fields on tracked items without leaving the tracking view or opening modal dialogs. The most frequently edited fields are:
- **Title** — refining task names as they evolve
- **Due Date** — setting or adjusting deadlines
- **Owner** — assigning responsibility or updating ownership

## Decision

Implement click-to-edit inline editing for three tracked item fields: title, due date, and owner.

### Implementation Details

**Pattern**: Click-to-edit with visual affordances
- Editable fields display with a dashed underline on hover to indicate they're interactive
- Title includes a pencil icon (✏️) that appears on hover
- Clicking either the text or the pencil icon activates edit mode
- Edit mode replaces the span with an appropriate input element

**Input Types**:
- **Title & Owner**: `<input type="text">` — free text entry
- **Due Date**: `<input type="date">` — native browser date picker

**Save/Cancel Triggers**:
- **Save**: blur (click away), Enter key, or date picker change event
- **Cancel**: Escape key (reverts to original value by re-rendering)

**New Optional Fields**:
- `dueAt` and `owner` are now editable fields but may be null on existing items
- Placeholders guide users to set values: "Set due date" / "Set owner" (in muted italic text)

### Technical Changes

**Model Layer** (`renderer/models/tracking.js`):
- Added `updateTrackingItemField(itemId, field, value)` function
- Updates a single field on a tracking item and persists to localStorage
- Returns `{ item, oldValue, newValue }` for potential undo/logging

**View Layer** (`renderer/renderers/tracking.js`):
- **Card view**: Title wrapped in `.item-title-wrap` with `.editable-field` span and `.edit-field-btn`
- **Row view**: Title, due date, and owner wrapped in `.editable-field` spans
- Both views show placeholder text for unset fields

**Event Layer** (`renderer/events.js`):
- Event delegation on `elements.trackingList` for clicks on `.editable-field` or `.edit-field-btn`
- `activateInlineEdit(span, field, itemId)` function handles input creation and save/cancel logic
- Date fields convert between ISO strings (storage) and YYYY-MM-DD format (date input) transparently

**Presentation Layer** (`styles/tracking.css`):
- `.editable-field` — cursor pointer, dashed underline on hover
- `.edit-field-btn` — pencil icon with opacity 0 by default, opacity 1 on parent hover
- `.inline-edit` — clean input styling with focus ring matching design system
- `.field-placeholder` — muted italic text for unset fields

### Benefits

1. **Context preservation**: Users stay in the tracking view, no modal dialogs or navigation required
2. **Visual clarity**: Hover states and edit icons clearly indicate editable fields
3. **Consistent UX**: Same editing pattern works in both card and row views
4. **Data integrity**: Re-rendering after save ensures all views stay in sync
5. **Graceful degradation**: Placeholders guide users to populate optional fields

### Constraints

- No undo mechanism (yet) — edits save immediately on blur/Enter
- Re-rendering on save means edit mode doesn't persist across renders
- Popout window view doesn't include inline editing (separate concern)

## Alternatives Considered

1. **Modal dialogs for editing** — Rejected: breaks user flow, requires more clicks
2. **Separate edit view/page** — Rejected: too much navigation overhead
3. **Edit all fields at once** — Rejected: too complex, users typically edit one field at a time

## Validation

- All 430 tests pass after implementation
- No existing functionality broken (expand/collapse, mark seen, delete, monitoring controls)
- Visual design consistent with Apple-inspired theme system

## Key Files

- `src/renderer/models/tracking.js` — data model update function
- `src/renderer/renderers/tracking.js` — template changes for card and row views
- `src/renderer/events.js` — event handlers for inline editing
- `src/styles/tracking.css` — inline editing styles
