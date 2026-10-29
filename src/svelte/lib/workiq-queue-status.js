// Operation leases protect resources; only main-process queue snapshots describe running requests.
export function queuePresentation(status, connected, now = Date.now()) {
  const active = status?.active || 0;
  const pending = status?.pending || 0;
  const seconds = Math.max(0, Math.ceil(((status?.cooldownUntil || 0) - now) / 1000));
  const busy = active > 0 || pending > 0;
  const counts = `${active} running / ${pending} queued`;
  return {
    label: seconds > 0 ? `${counts} · retry in ${seconds}s` : busy ? counts : connected ? 'Connected' : 'Ready',
    className: busy || seconds > 0 ? 'loading' : connected ? 'connected' : '',
  };
}

export function watchWorkiqQueue(api, onChange, onError = (error) => console.warn('[flightdeck] Queue status unavailable', error)) {
  let disposed = false;
  let revision = 0;
  let unsubscribe;
  let timer;
  let status;
  function publish(snapshot) {
    if (disposed) return;
    status = snapshot;
    if (timer) clearInterval(timer);
    timer = null;
    onChange({ ...status });
    if (status?.cooldownUntil > Date.now()) {
      timer = setInterval(() => {
        onChange({ ...status });
        if (!(status?.cooldownUntil > Date.now())) {
          clearInterval(timer);
          timer = null;
        }
      }, 1000);
    }
  }
  const report = (error) => { if (!disposed) onError(error); };
  const initialRevision = revision;
  try {
    if (typeof api?.onWorkiqQueueStatus === 'function') {
      unsubscribe = api.onWorkiqQueueStatus((snapshot) => {
        revision += 1;
        publish(snapshot);
      });
    }
  } catch (error) {
    report(error);
  }
  if (typeof api?.getWorkiqQueueStatus === 'function') {
    Promise.resolve().then(() => api.getWorkiqQueueStatus()).then((snapshot) => {
      if (revision === initialRevision) publish(snapshot);
    }).catch(report);
  }
  return () => {
    disposed = true;
    if (timer) clearInterval(timer);
    if (typeof unsubscribe === 'function') unsubscribe();
  };
}
