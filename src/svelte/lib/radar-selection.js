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
