const activeTrackers = new Set();

export function invalidateThreadComposerRequests() {
  for (const tracker of activeTrackers) tracker.invalidate();
}

export function createThreadComposerRequestTracker() {
  let currentThreadId = null;
  let generation = 0;

  function setThread(threadId) {
    const nextThreadId = threadId || null;
    if (nextThreadId === currentThreadId) return generation;
    currentThreadId = nextThreadId;
    generation += 1;
    return generation;
  }

  function begin(threadId) {
    setThread(threadId);
    return { threadId: threadId || null, generation };
  }

  function isCurrent(request) {
    return Boolean(request)
      && request.generation === generation
      && request.threadId === currentThreadId;
  }

  function invalidate() {
    generation += 1;
    return generation;
  }

  const tracker = { begin, invalidate, isCurrent, setThread };
  activeTrackers.add(tracker);
  return tracker;
}