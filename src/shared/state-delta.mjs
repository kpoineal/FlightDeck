const same = (left, right) => {
  if (Object.is(left, right)) return true;
  if (!left || !right || typeof left !== 'object' || typeof right !== 'object') return false;
  const keys = Object.keys(left);
  return keys.length === Object.keys(right).length && keys.every(key => Object.hasOwn(right, key) && same(left[key], right[key]));
};
const ignored = new Set(['repositoryRevision', 'residency', 'historyPartial', 'mailboxReadRequestId']);
export function stateDelta(base, current) {
  const changes = [];
  for (const [domain, key] of [['threads','items'],['scanners','scanners'],['proposals','actionProposals'],['history','history']]) {
    const prior = new Map((base[key] || []).map(row => [row.id, row]));
    const rows = new Map((current[key] || []).map(row => [row.id, row]));
    for (const [id, row] of rows) {
      const old = prior.get(id);
      if (domain === 'threads') {
        const patch = Object.fromEntries(Object.entries(row).filter(([field, value]) => !ignored.has(field) && field !== 'id' && (!old || !same(old[field], value))));
        // A read action on a projection acknowledges hidden history even when read flags were already false.
        const markRead = Boolean(old && row.mailboxReadRequestId && row.mailboxReadRequestId !== old.mailboxReadRequestId);
        if (markRead) {
          patch.isNew = row.isNew === true;
          patch.hasNewUpdate = row.hasNewUpdate === true;
        }
        if (Object.keys(patch).length || markRead) changes.push({ domain, id, patch, create: !old,
          partialHistory: old?.historyPartial === true, ...(markRead ? { markRead: true } : {}) });
      } else if (!old || !same(old, row)) changes.push({ domain, id, value: row, order: [...rows.keys()].indexOf(id) });
    }
    // Missing projection rows are not deletions. Only explicit tombstones delete threads.
    if (domain !== 'threads') for (const id of prior.keys()) if (!rows.has(id)) changes.push({ domain, id, remove: true });
  }
  const tombstones = new Set(base.deletedItemIds || []);
  for (const id of current.deletedItemIds || []) if (!tombstones.has(id)) changes.push({ domain: 'deletedItemIds', id });
  for (const id of ['density','filter','collapsedSections','scannerSortPrefs','connectionIntent','meetings',
    'meetingsLastFetched','briefingsByMeetingId','briefingSeenAt']) {
    if (!same(base[id], current[id])) changes.push({ domain: 'preferences', id, value: current[id] });
  }
  return changes;
}

export function captureStateDelta(base, current) {
  const changes = stateDelta(base, current);
  const included = { ...base };
  for (const [domain, key] of [['threads','items'],['scanners','scanners'],['proposals','actionProposals'],['history','history']]) {
    const changed = new Set(changes.filter(change => change.domain === domain).map(change => change.id));
    const prior = new Map((base[key] || []).map(row => [row.id, row]));
    included[key] = (current[key] || []).map(row => changed.has(row.id) || !prior.has(row.id) ? structuredClone(row) : prior.get(row.id));
  }
  included.deletedItemIds = [...current.deletedItemIds || []];
  for (const change of changes.filter(change => change.domain === 'preferences')) included[change.id] = structuredClone(change.value);
  return { changes: structuredClone(changes), included };
}
