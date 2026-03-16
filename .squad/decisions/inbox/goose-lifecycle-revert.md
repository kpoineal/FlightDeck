# Decision: Revert Lifecycle Model & Bulk Selection (Phase 3)

**Date:** 2026-03-10  
**Author:** Goose (Frontend Dev)  
**Status:** Implemented  
**Branch:** feature/ui-ux-three-phase

## Context

The three-phase UI enhancement included:
- **Phase 1**: Origin indicators (custom/imported) to show where items came from
- **Phase 2**: Visual polish (typography, spacing, has-new-update styling)
- **Phase 3**: Lifecycle state machine (inbox/active/archived filter tabs) and bulk selection/actions

the user requested removing Phase 3 while preserving Phases 1 and 2. The lifecycle model added complexity that wasn't essential to the core tracking workflow.

## Decision

Remove all Phase 3 lifecycle and bulk selection features:

### Removed Components
1. **State Machine**: `LIFECYCLE_STATES` enum and lifecycle transition logic
2. **UI Elements**: Filter tabs (All/Inbox/Active/Archived) and bulk actions bar
3. **Functions**: `normalizeLifecycleState()`, `transitionLifecycleState()`, `markItemsSeen()`, `bulkTransitionLifecycle()`, `archiveCompletedItems()`, `filterItemsByLifecycle()`, `syncTrackingBulkSelection()`, `updateBulkActionsBar()`
4. **State Fields**: `trackingFilter`, `trackingBulkSelection`
5. **DOM Elements**: Bulk checkboxes (`data-bulk-select-id`), filter tabs, bulk actions bar
6. **CSS**: `.bulk-select-toggle`, `.is-selected-bulk`, `.filter-tab`, `.bulk-actions-bar` styles

### Preserved Features
1. **Origin Pills**: Custom vs Imported badges still show item provenance
2. **Visual Polish**: Typography hierarchy, spacing, `has-new-update` badges
3. **Mark as Seen**: Still works but no longer transitions lifecycle state

## Rationale

- **Simplicity**: The tracking view doesn't need lifecycle categorization — users can see all items and mark them as seen when done
- **Maintainability**: Fewer state transitions and edge cases to handle
- **UI Clarity**: Removing filter tabs reduces cognitive load
- **Phase Isolation**: This revert proves the modular architecture allows surgical feature removal

## Implementation Notes

- All changes were scoped to frontend rendering/state code
- No IPC protocol changes (Viper's domain was untouched)
- Tests updated to remove lifecycle-specific assertions
- All 369 tests pass after removal

## Future Considerations

If the user later wants filtering:
- Use simpler boolean filters (e.g., "Show only with new updates")
- Avoid stateful transitions — derive filters from existing properties
- Keep bulk actions separate from lifecycle state if re-introduced
