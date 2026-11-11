import { isMailboxActive, isMailboxArchived, isMailboxSnoozed, isMailboxUnread } from './mailbox.js';

export function inboxActionState(targets, at = Date.now()) {
  const unsnooze = targets.length > 0 && targets.every(item => isMailboxSnoozed(item, at));
  return {
    markRead: targets.some(isMailboxUnread),
    archive: targets.some(item => !isMailboxArchived(item)),
    unsnooze,
    snoozeBlocked: !unsnooze && targets.some(item => !isMailboxActive(item)),
    lifecycle: targets.length && targets.every(item => item.lifecycleStatus === targets[0].lifecycleStatus)
      ? targets[0].lifecycleStatus : null,
    severity: targets.length && targets.every(item => item.severity === targets[0].severity)
      ? targets[0].severity : null,
  };
}
