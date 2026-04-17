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

// ── Demo mode ────────────────────────────────────────────────────────
export const isDemo = writable(false);

// ── UI state stores ──────────────────────────────────────────────────
export const connected = writable(false);
export const loading = writable(false);
export const mode = writable('Radar');
export const density = writable('full');
export const filter = writable('all');
export const collapsedSections = writable([]);
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
    blocked: active.filter(i => i.isBlocked).length,
    new: active.filter(i => i.isNew).length,
    complete: $items.filter(i => i.lifecycleStatus === 'complete').length,
  };
});

/** Cold storage items fetched async when viewing archived filter. */
export const coldItems = writable([]);

/** Filtered items based on current filter selection. */
export const filteredItems = derived([items, coldItems, filter], ([$items, $coldItems, $filter]) => {
  if ($filter === 'archived') {
    const hot = $items.filter(i => i.lifecycleStatus === 'complete' || i.lifecycleStatus === 'archived');
    // Merge cold storage items (deduped by id)
    const hotIds = new Set(hot.map(i => i.id));
    const uniqueCold = $coldItems.filter(i => !hotIds.has(i.id));
    return [...hot, ...uniqueCold];
  }
  return $items.filter(i => i.lifecycleStatus !== 'complete' && i.lifecycleStatus !== 'archived');
});
