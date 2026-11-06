'use strict';

function createConnectionState(validate, notify = () => {}) {
  let generation = 0;
  let status = 'disconnected';
  let pending = null;
  const publish = (next) => { status = next; notify({ status }); };
  return {
    getStatus: () => ({ status }),
    isReady: () => status === 'ready',
    disconnect() {
      generation++;
      pending = null;
      publish('disconnected');
      return { success: true };
    },
    invalidate() {
      generation++;
      pending = null;
      publish('failed');
    },
    validate({ retry = false } = {}) {
      if (pending) return pending;
      if (status === 'ready' && !retry) return Promise.resolve({ success: true });
      const current = ++generation;
      publish('validating');
      pending = Promise.resolve().then(validate).then(
        result => ({ success: result?.success === true }),
        () => ({ success: false }),
      ).then(result => {
        if (current !== generation) return { success: false, code: 'SUPERSEDED' };
        pending = null;
        publish(result.success ? 'ready' : 'failed');
        return result;
      });
      return pending;
    },
  };
}

module.exports = { createConnectionState };
