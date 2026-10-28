import { activeOperations } from './stores.js';

let operationSequence = 0;

export function scannerOperationKey(scannerId) {
  const normalized = String(scannerId || '').trim();
  return normalized ? `scanner:${normalized}` : null;
}

export function itemOperationKey(itemId) {
  const normalized = String(itemId || '').trim();
  return normalized ? `item:${normalized}` : null;
}

export function tryAcquireOperationGuards(keys, operation = {}) {
  const normalizedKeys = [...new Set((Array.isArray(keys) ? keys : [keys]).filter(Boolean))];
  if (!normalizedKeys.length) return null;

  const leaseId = `operation-${Date.now()}-${operationSequence++}`;
  let acquired = false;
  activeOperations.update((operations) => {
    const current = operations instanceof Map ? operations : new Map();
    if (normalizedKeys.some((key) => current.has(key))) return operations;

    const next = new Map(current);
    for (const key of normalizedKeys) {
      next.set(key, { ...operation, leaseId });
    }
    acquired = true;
    return next;
  });

  return acquired ? { leaseId, keys: normalizedKeys } : null;
}

export function releaseOperationGuards(lease) {
  if (!lease?.leaseId || !Array.isArray(lease.keys)) return;
  activeOperations.update((operations) => {
    const current = operations instanceof Map ? operations : new Map();
    const next = new Map(current);
    let changed = false;
    for (const key of lease.keys) {
      if (next.get(key)?.leaseId !== lease.leaseId) continue;
      next.delete(key);
      changed = true;
    }
    return changed ? next : operations;
  });
}