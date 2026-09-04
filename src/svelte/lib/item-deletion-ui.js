export const ITEM_DELETION_CONFIRMATION = Object.freeze({
  title: 'Delete card from FlightDeck?',
  summary: 'This permanently removes the card from FlightDeck. It does not delete the source email, Teams message or chat, meeting, document, or other Microsoft 365 content.',
  confirmLabel: 'Delete card',
});

export function itemDeletionFailureMessage(code) {
  return code === 'PERSISTENCE_RECOVERY_REQUIRED'
    ? 'FlightDeck could not verify the saved state. Reload before trying again.'
    : 'Could not delete the card. Nothing was removed.';
}