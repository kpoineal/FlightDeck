// ── App actions (state mutation helpers) ─────────────────────────────
import { history, mode, density, filter, collapsedSections } from './stores.js';
import { nowIso } from './utils.js';
import { pruneHistory, savePersistentState } from './persistence.js';

export function addHistory(kind, summary, payload = {}) {
  pruneHistory();
  history.update((h) => {
    const entry = {
      id: `h_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
      at: nowIso(),
      kind,
      summary,
      payload,
    };
    return [entry, ...h];
  });
}

export function setMode(newMode) {
  if (newMode === 'Tracking') newMode = 'Radar';
  mode.set(newMode);
}

export function setDensity(value) {
  density.set(value === 'minimal' ? 'minimal' : 'full');
}

export function setFilter(value) {
  filter.set(value === 'archived' ? 'archived' : 'all');
}

export function toggleSection(sectionId) {
  collapsedSections.update((sections) => {
    if (sections.includes(sectionId)) {
      return sections.filter((s) => s !== sectionId);
    }
    return [...sections, sectionId];
  });
}
