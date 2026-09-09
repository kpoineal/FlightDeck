// ── Svelte reactive stores ───────────────────────────────────────────
import { writable, derived } from 'svelte/store';

// ── Core state stores ────────────────────────────────────────────────
export const items = writable([]);
export const scanners = writable([]);
export const meetings = writable([]);
export const meetingsLastFetched = writable(0);
export const briefingsByMeetingId = writable({});
export const briefingSeenAt = writable({});
export const history = writable([]);
export const actionProposals = writable([]);
export const deletedItemIds = writable([]);

// ── Demo mode ────────────────────────────────────────────────────────
export const isDemo = writable(false);

// ── UI state stores ──────────────────────────────────────────────────
export const connected = writable(false);

/** Map of active WorkIQ operations, keyed by type:id (e.g., 'scanner:abc123', 'item:xyz789') */
export const activeOperations = writable(new Map());

/** Backward-compatible loading flag — true when any operation is active */
export const loading = derived(activeOperations, ($ops) => $ops.size > 0);
export const mode = writable('Today');
export const actionsQueueOpen = writable(false);
export const actionsQueueFocusOrigin = writable(null);
export function openActionsQueue(initiator = null) {
  const activeElement = typeof document === 'undefined' ? null : document.activeElement;
  actionsQueueFocusOrigin.set(initiator || activeElement);
  actionsQueueOpen.set(true);
}
export const selectedProposalId = writable(null);
export const density = writable('full');
export const filter = writable('all');
export const collapsedSections = writable([]);
export const scannerSortPrefs = writable({});
export const expandedBriefingMeetingIds = writable([]);

// ── Navigation / highlight stores ────────────────────────────────────
/** Item ID to scroll to and highlight (set by notification click, search, etc.) */
export const highlightedItemId = writable(null);

// ── Derived stores ───────────────────────────────────────────────────

/** KPI counts derived from items. */
export const kpis = derived(items, ($items) => {
  const active = $items.filter(i => i.lifecycleStatus !== 'archived' && i.lifecycleStatus !== 'complete');
  return {
    critical: active.filter(i => i.severity === 'Critical').length,
    elevated: active.filter(i => i.severity === 'Elevated').length,
    observe: active.filter(i => i.severity === 'Observe' || i.severity === 'Monitor').length,
    total: active.length,
    blocked: active.filter(i => i.lifecycleStatus === 'blocked').length,
    new: active.filter(i => i.isNew).length,
    complete: $items.filter(i => i.lifecycleStatus === 'complete').length,
  };
});

/** Cold storage items fetched async when viewing archived filter. */
export const coldItems = writable([]);

/** Filtered items based on current filter selection. */
export const filteredItems = derived([items, coldItems, deletedItemIds, filter], ([$items, $coldItems, $deletedItemIds, $filter]) => {
  const deletedIds = new Set($deletedItemIds);
  if ($filter === 'archived') {
    const hot = $items.filter(i => !deletedIds.has(i.id) && (i.lifecycleStatus === 'complete' || i.lifecycleStatus === 'archived'));
    // Merge cold storage items (deduped by id)
    const hotIds = new Set(hot.map(i => i.id));
    const uniqueCold = $coldItems.filter(i => !deletedIds.has(i.id) && !hotIds.has(i.id));
    return [...hot, ...uniqueCold];
  }
  return $items.filter(i => !deletedIds.has(i.id) && i.lifecycleStatus !== 'complete' && i.lifecycleStatus !== 'archived');
});
