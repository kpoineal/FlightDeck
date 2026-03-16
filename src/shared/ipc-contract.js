const IPC_CHANNELS = {
  GET_APP_VERSION: 'get-app-version',
  ASK_WORKIQ: 'ask-workiq',
  ACCEPT_WORKIQ_EULA: 'accept-workiq-eula',
  READ_PROMPT_FILE: 'read-prompt-file',
  OPEN_MARKDOWN_WINDOW: 'open-markdown-window',
  OPEN_EXTERNAL: 'open-external',
  SHOW_DESKTOP_NOTIFICATION: 'show-desktop-notification',
  OPEN_TRACKER_POPOUT: 'open-tracker-popout',
  TRACKER_STATE_CHANGED: 'tracker-state-changed',
  TRACKER_STATE_SYNC: 'tracker-state-sync',
  NOTIFICATION_CLICKED: 'notification-clicked',
  STORE_GET: 'store-get',
  STORE_SET: 'store-set',
  STORE_DELETE: 'store-delete',
  STORE_GET_ALL: 'store-get-all',
  STORE_GET_SIZE: 'store-get-size',
  STORE_MIGRATE_FROM_LOCALSTORAGE: 'store-migrate-from-localstorage',
};

module.exports = {
  IPC_CHANNELS,
};
