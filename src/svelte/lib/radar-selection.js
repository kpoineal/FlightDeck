export function reconcileRadarSelection(state, threads, { preserveId = null } = {}) {
  const visibleIds = new Set((threads || []).map((thread) => thread.id));
  const selectedId = state.selectedId;

  if (selectedId && selectedId !== preserveId && !visibleIds.has(selectedId)) {
    return {
      ...state,
      selectedId: null,
      mobileStep: state.mobileStep === 'detail' ? 'list' : state.mobileStep,
    };
  }

  return { ...state };
}

export function nextItemSelectionAfterRemoval(threads, removedId) {
  const entries = Array.isArray(threads) ? threads : [];
  const removedIndex = entries.findIndex((thread) => thread?.id === removedId);
  if (removedIndex < 0) return null;
  return entries[removedIndex + 1]?.id || entries[removedIndex - 1]?.id || null;
}

export function nextRadarSelectionAfterRemoval(threads, removedId) {
  return nextItemSelectionAfterRemoval(threads, removedId);
}

export function selectInboxRows(visibleIds, selectedIds, anchorId, targetId, { additive = false, range = false } = {}) {
  const visible = new Set(visibleIds);
  const current = selectedIds.filter(id => visible.has(id));
  if (!visible.has(targetId)) return { ids: current, anchorId: visible.has(anchorId) ? anchorId : null };
  if (range && visible.has(anchorId)) {
    const start = visibleIds.indexOf(anchorId);
    const end = visibleIds.indexOf(targetId);
    const span = visibleIds.slice(Math.min(start, end), Math.max(start, end) + 1);
    return { ids: additive ? [...new Set([...current, ...span])] : span, anchorId };
  }
  return {
    ids: additive ? current.includes(targetId) ? current.filter(id => id !== targetId) : [...current, targetId] : [targetId],
    anchorId: targetId,
  };
}
