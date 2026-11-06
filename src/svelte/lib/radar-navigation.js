import { get } from 'svelte/store';
import {
  coldItems,
  collapsedSections,
  deletedItemIds,
  filter,
  highlightedItemId,
  items,
  mode,
  scanners,
} from './stores.js';
import { filterDeletedItems, normalizeItemId, reconcileHydratedItems } from './models/item.js';
import { rememberRepositoryThread, usesRepository } from './repository-context.js';

let coldHydrationPromise = null;
const detailHydrations = new Map();
let navigationGeneration = 0;

function findItem(itemId) {
  const normalizedId = normalizeItemId(itemId);
  if (!normalizedId || get(deletedItemIds).includes(normalizedId)) return null;

  const hot = get(items).find((item) => item?.id === normalizedId);
  if (hot) return hot;
  return get(coldItems).find((item) => item?.id === normalizedId) || null;
}

export function hydrateRadarColdItems() {
  if (usesRepository()) return Promise.resolve(get(coldItems));
  const getColdItems = window.workiq?.getColdItems;
  if (typeof getColdItems !== 'function') return Promise.resolve([]);
  if (coldHydrationPromise) return coldHydrationPromise;

  coldHydrationPromise = Promise.resolve()
    .then(() => getColdItems())
    .then((result) => {
      if (Array.isArray(result)) {
        coldItems.update((current) => reconcileHydratedItems(current, result, get(deletedItemIds)));
        return filterDeletedItems(result, get(deletedItemIds));
      }
      return [];
    })
    .catch(() => [])
    .finally(() => { coldHydrationPromise = null; });
  return coldHydrationPromise;
}

export async function resolveRadarItem(itemId) {
  const normalizedId = normalizeItemId(itemId);
  if (!normalizedId) return null;

  const immediate = findItem(normalizedId);
  if (immediate && (!usesRepository() || !immediate.historyPartial)) return immediate;
  if (usesRepository()) {
    if (detailHydrations.has(normalizedId)) return detailHydrations.get(normalizedId);
    const pending = (async () => {
      const before = immediate ? structuredClone(immediate) : null;
      const item = await window.workiq.stateQuery('getThread', { id: normalizedId });
      if (!item || get(deletedItemIds).includes(normalizedId)) return null;
      const live = findItem(normalizedId);
      if (live && before && JSON.stringify(live) !== JSON.stringify(before)) return live;
      rememberRepositoryThread(item);
      if (get(items).some(row => row.id === item.id)) items.update(rows => rows.map(row => row.id === item.id ? item : row));
      else coldItems.update(rows => [...rows.filter(row => row.id !== item.id), item]);
      return item;
    })();
    detailHydrations.set(normalizedId, pending);
    try { return await pending; }
    finally { detailHydrations.delete(normalizedId); }
  }

  await hydrateRadarColdItems();
  return findItem(normalizedId);
}

export async function navigateToRadarItem(itemId) {
  const generation = ++navigationGeneration;
  const normalizedId = normalizeItemId(itemId);
  if (!normalizedId) return false;

  await resolveRadarItem(normalizedId);
  if (generation !== navigationGeneration) return false;

  const target = findItem(normalizedId);
  if (!target) return false;

  filter.set('all');
  mode.set('Radar');

  if (target.scannerId) {
    const sectionId = `scanner-${target.scannerId}`;
    const allSectionIds = get(scanners).map((scanner) => `scanner-${scanner.id}`);
    collapsedSections.set(allSectionIds.filter((id) => id !== sectionId));
  }

  highlightedItemId.set(target.id);
  return true;
}