const equal = (left, right) => JSON.stringify(left) === JSON.stringify(right);
const object = value => value !== null && typeof value === 'object' && !Array.isArray(value);
const key = value => object(value) && (value.id || value.eventId || value.proposalId)
  ? `id:${value.id || value.eventId || value.proposalId}`
  : value?.kind === 'merge' && value.mergedFromId
    ? `merge:${value.mergedFromId}:${value.timestamp}` : JSON.stringify(value);

// Undo only values still owned by this mutation, retaining edits made while persistence awaited.
export function undoMutation(before, applied, current) {
  if (equal(applied, current)) return structuredClone(before);
  if (equal(before, applied)) return current;
  if (Array.isArray(before) && Array.isArray(applied) && Array.isArray(current)) {
    const originals = new Map(before.map(value => [key(value), value]));
    const written = new Map(applied.map(value => [key(value), value]));
    const result = current.flatMap(value => {
      const id = key(value);
      if (!written.has(id)) return [value];
      if (!originals.has(id)) return equal(value, written.get(id)) || written.get(id)?.kind === 'merge' ? [] : [value];
      return [undoMutation(originals.get(id), written.get(id), value)];
    });
    for (const value of before) {
      if (!written.has(key(value)) && !result.some(row => key(row) === key(value))) result.push(value);
    }
    return result;
  }
  if (object(before) && object(applied) && object(current)) {
    const result = { ...current };
    for (const field of new Set([...Object.keys(before), ...Object.keys(applied)])) {
      if (equal(before[field], applied[field])) continue;
      if (!Object.hasOwn(current, field)) continue;
      if (!Object.hasOwn(before, field) && equal(current[field], applied[field])) delete result[field];
      else result[field] = undoMutation(before[field], applied[field], current[field]);
    }
    return result;
  }
  return current;
}

export function rollbackThreadStores(before, applied, hot, cold) {
  const original = [...before.hot, ...before.cold];
  const written = [...applied.hot, ...applied.cold];
  const restored = undoMutation(original, written, [...hot, ...cold]);
  const coldIds = new Set(before.cold.map(row => row.id));
  const hotIds = new Set(before.hot.map(row => row.id));
  const currentCold = new Set(cold.map(row => row.id));
  return {
    hot: restored.filter(row => hotIds.has(row.id) || (!coldIds.has(row.id) && !currentCold.has(row.id))),
    cold: restored.filter(row => coldIds.has(row.id) || (!hotIds.has(row.id) && currentCold.has(row.id))),
  };
}
