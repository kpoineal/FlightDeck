'use strict';

function createStateSessions() {
  let revision = 0;
  let lease = null;
  let recoveryRequired = false;
  return {
    revision: () => revision,
    acquire(sender, expected) {
      if (recoveryRequired) return { ok: false, code: 'RECOVERY_REQUIRED', revision };
      if (!sender || !Number.isSafeInteger(expected) || expected !== revision) return { ok: false, code: 'CONFLICT', revision };
      if (lease) return { ok: false, code: 'BUSY', revision };
      lease = { sender, touched: false };
      lease.destroyed = () => {
        if (lease?.sender === sender) {
          recoveryRequired = lease.touched;
          lease = null;
        }
      };
      sender.once?.('destroyed', lease.destroyed);
      return { ok: true, revision };
    },
    assertOwner(sender) {
      if (recoveryRequired || !lease || lease.sender !== sender) throw new Error('STATE_LEASE_REQUIRED');
      lease.touched = true;
    },
    assertReadable(sender) {
      if (recoveryRequired) throw new Error('STATE_RECOVERY_REQUIRED');
      if (lease && lease.sender !== sender) throw new Error('STATE_BUSY');
    },
    release(sender, recovered = true) {
      if (!lease || lease.sender !== sender) return { ok: false, code: 'LEASE_REQUIRED', revision };
      if (lease.touched) revision++;
      recoveryRequired = !recovered;
      sender.removeListener?.('destroyed', lease.destroyed);
      lease = null;
      return { ok: recovered, revision };
    },
  };
}
module.exports = { createStateSessions };
