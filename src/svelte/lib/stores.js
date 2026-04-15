// ── Svelte reactive stores ───────────────────────────────────────────
import { writable, derived } from 'svelte/store';

// ── Core state stores ────────────────────────────────────────────────
export const items = writable([]);
export const scanners = writable([]);
export const meetings = writable([]);
export const briefingsByMeetingId = writable({});
export const briefingSeenAt = writable({});
export const history = writable([]);

// ── UI state stores ──────────────────────────────────────────────────
export const connected = writable(false);
export const loading = writable(false);
export const mode = writable('Radar');
export const density = writable('full');
export const filter = writable('all');
export const collapsedSections = writable([]);
export const expandedBriefingMeetingIds = writable([]);

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

/** Filtered items based on current filter selection. */
export const filteredItems = derived([items, filter], ([$items, $filter]) => {
  if ($filter === 'archived') {
    return $items.filter(i => i.lifecycleStatus === 'archived');
  }
  return $items.filter(i => i.lifecycleStatus !== 'archived');
});
