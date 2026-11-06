// Explicit user-review data, deliberately separate from content-free timing diagnostics.
export function findSourceCollisions({ hot = [], cold = [], scanners = [], deletedItemIds = [] }, collectIdentities) {
  const deleted = new Set(deletedItemIds);
  const scannerById = new Map(scanners.map(scanner => [scanner.id, scanner]));
  const retained = new Map();
  for (const [tier, entries] of [['cold', cold], ['hot', hot]]) {
    for (const thread of entries) {
      if (thread?.id && !deleted.has(thread.id)) retained.set(thread.id, { thread, tier });
    }
  }
  const owners = new Map();
  for (const { thread, tier } of retained.values()) {
    for (const identity of new Set(collectIdentities(thread))) {
      const entries = owners.get(identity) || [];
      const scanner = scannerById.get(thread.scannerId);
      entries.push({
        threadId: thread.id, title: thread.title || '', tier, lifecycleStatus: thread.lifecycleStatus,
        scannerId: thread.scannerId || null, scannerName: scanner?.name || 'Unassigned',
        crossScannerDedup: scanner?.crossScannerDedup !== false,
      });
      owners.set(identity, entries);
    }
  }
  return [...owners.entries()].filter(([, entries]) => entries.length > 1).map(([identity, entries]) => ({
    identity,
    owners: entries,
    sameScannerCollision: entries.some((entry, index) => entries.slice(index + 1).some(other => other.scannerId === entry.scannerId)),
    // Cross-scanner policy is directional: each candidate scanner controls acceptance.
    allowsCrossScannerDuplicate: entries.some(entry => entry.crossScannerDedup === false),
  })).sort((left, right) => left.identity.localeCompare(right.identity));
}
