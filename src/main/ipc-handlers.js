const { app, ipcMain, BrowserWindow, shell, Notification } = require('electron');
const path = require('path');
const fs = require('fs');
const { log, logError, normalizeExternalUrl, escapeHtml, markdownToHtml, attachExternalNavigationGuards } = require('./utils');
const { runWorkiqCommand, runWorkiqAcceptEula } = require('./pty-bridge');
const { registerTrackerPopoutIpc } = require('./ipc/tracker-popout');
const { IPC_CHANNELS } = require('../shared/ipc-contract');
const { storeGet, storeSet, storeDelete, storeGetAll, storeGetSize } = require('./store');

const APP_ROOT = path.join(__dirname, '..');

// Hold references to active notifications to prevent garbage collection
// before the user clicks them (Windows toast notifications).
const activeNotifications = new Set();

function registerIpcHandlers(getMainWindow, popoutWindows) {

  ipcMain.handle(IPC_CHANNELS.GET_APP_VERSION, () => app.getVersion());

  ipcMain.handle(IPC_CHANNELS.ASK_WORKIQ, async (_event, question) => {
    return runWorkiqCommand(question);
  });

  ipcMain.handle(IPC_CHANNELS.ACCEPT_WORKIQ_EULA, async () => {
    return runWorkiqAcceptEula();
  });

  ipcMain.handle(IPC_CHANNELS.READ_PROMPT_FILE, async (_event, filename) => {
    const sanitized = path.basename(String(filename || ''));
    const promptPath = path.join(APP_ROOT, 'prompts', sanitized);

    try {
      const content = fs.readFileSync(promptPath, 'utf-8');
      return { success: true, content };
    } catch (e) {
      logError('[main] Failed to read prompt file:', sanitized, e.message);
      return { success: false, error: e.message };
    }
  });

  ipcMain.handle(IPC_CHANNELS.OPEN_MARKDOWN_WINDOW, async (_event, payload) => {
    const title = payload?.title || 'Draft Preview';
    const markdown = payload?.markdown || '';
    const instructions = payload?.instructions || '';
    const rawHtml = payload?.rawHtml || '';

    const preview = new BrowserWindow({
      width: 760,
      height: 620,
      autoHideMenuBar: true,
      webPreferences: {
        contextIsolation: true,
        nodeIntegration: false,
      },
    });

    attachExternalNavigationGuards(preview);

    preview.setTitle(title);

    if (rawHtml) {
      log('[main] Ignoring rawHtml in markdown preview payload; rendering markdown only.');
    }

    const rendered = markdownToHtml(markdown);
    const instructionsHtml = markdownToHtml(instructions);

    const html = `<!DOCTYPE html>
<html lang="en">
<head>
  <meta charset="UTF-8" />
  <title>${escapeHtml(title)}</title>
  <style>
    *, *::before, *::after { box-sizing: border-box; margin: 0; padding: 0; }

    :root {
      color-scheme: dark light;
      --bg-body: #09090b;
      --bg-surface: rgba(24, 24, 27, 0.82);
      --bg-inset: rgba(39, 39, 42, 0.78);
      --border-card: rgba(255, 255, 255, 0.15);
      --border-subtle: rgba(255, 255, 255, 0.08);
      --text: #ffffff;
      --text-secondary: #ebebf5;
      --text-muted: rgba(235, 235, 245, 0.6);
      --text-dim: rgba(235, 235, 245, 0.3);
      --accent: #0a84ff;
      --link: #64d2ff;
      --shadow-card: 0 4px 24px rgba(0, 0, 0, 0.2);
      --shadow-panel: 0 8px 32px rgba(0, 0, 0, 0.4);
      --glow: 0 0 20px rgba(10, 132, 255, 0.08);
      --radius: 16px;
      --radius-sm: 12px;
      --blur: 20px;
    }
    @media (prefers-color-scheme: light) {
      :root {
        --bg-body: #f5f5f7;
        --bg-surface: rgba(255, 255, 255, 0.88);
        --bg-inset: rgba(244, 244, 249, 0.82);
        --border-card: rgba(0, 0, 0, 0.1);
        --border-subtle: rgba(0, 0, 0, 0.06);
        --text: #1d1d1f;
        --text-secondary: #3c3c43;
        --text-muted: rgba(60, 60, 67, 0.6);
        --text-dim: rgba(60, 60, 67, 0.35);
        --accent: #007aff;
        --link: #007aff;
        --shadow-card: 0 1px 4px rgba(0, 0, 0, 0.04), 0 4px 16px rgba(0, 0, 0, 0.06);
        --shadow-panel: 0 8px 32px rgba(0, 0, 0, 0.14);
        --glow: none;
      }
    }

    body {
      font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, Helvetica, Arial, sans-serif;
      background: var(--bg-body);
      color: var(--text);
      padding: 24px;
      line-height: 1.5;
      -webkit-font-smoothing: antialiased;
      -moz-osx-font-smoothing: grayscale;
    }

    .draft-window {
      display: flex;
      flex-direction: column;
      gap: 16px;
      max-width: 720px;
      margin: 0 auto;
    }

    .draft-header {
      display: flex;
      align-items: center;
      gap: 10px;
      padding-bottom: 12px;
      border-bottom: 1px solid var(--border-subtle);
    }
    .draft-icon {
      width: 32px; height: 32px;
      background: linear-gradient(135deg, var(--accent) 0%, color-mix(in srgb, var(--accent) 70%, #6366f1) 100%);
      border-radius: 8px;
      display: flex; align-items: center; justify-content: center;
      box-shadow: 0 2px 8px rgba(10, 132, 255, 0.25);
      flex-shrink: 0;
    }
    .draft-icon svg { width: 18px; height: 18px; }
    .draft-header h1 {
      font-size: 1.15rem;
      font-weight: 700;
      letter-spacing: -0.01em;
      color: var(--text);
    }

    .panel {
      border: 1px solid var(--border-card);
      background: var(--bg-surface);
      backdrop-filter: blur(var(--blur));
      -webkit-backdrop-filter: blur(var(--blur));
      border-radius: var(--radius);
      padding: 20px 22px;
      box-shadow: var(--shadow-card);
      transition: box-shadow 0.3s ease;
    }
    .panel:hover {
      box-shadow: var(--shadow-panel), var(--glow);
    }

    .panel-label {
      display: inline-block;
      font-size: 0.7rem;
      font-weight: 600;
      text-transform: uppercase;
      letter-spacing: 0.06em;
      color: var(--text-dim);
      margin-bottom: 12px;
    }

    .panel-instructions {
      background: var(--bg-inset);
      border: 1px solid var(--border-subtle);
    }

    h2 { font-size: 1rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 6px; }
    h3 { font-size: 0.9rem; font-weight: 600; color: var(--text-secondary); margin-bottom: 4px; }
    p { margin: 6px 0; line-height: 1.55; font-size: 0.92rem; color: var(--text-secondary); }
    ul { margin: 8px 0 8px 20px; }
    li { margin: 5px 0; line-height: 1.5; font-size: 0.88rem; color: var(--text-muted); }
    li::marker { color: var(--text-dim); }
    a { color: var(--link); text-decoration: none; font-weight: 500; }
    a:hover { text-decoration: underline; }
  </style>
</head>
<body>
  <div class="draft-window">
    <div class="draft-header">
      <div class="draft-icon">
        <svg viewBox="0 0 24 24" fill="none" stroke="white" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">
          <path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/>
          <polyline points="14 2 14 8 20 8"/>
          <line x1="16" y1="13" x2="8" y2="13"/>
          <line x1="16" y1="17" x2="8" y2="17"/>
          <polyline points="10 9 9 9 8 9"/>
        </svg>
      </div>
      <h1>${escapeHtml(title)}</h1>
    </div>
    <div class="panel">
      <span class="panel-label">Draft Content</span>
      ${rendered || '<p>(No content)</p>'}
    </div>
    <div class="panel panel-instructions">
      <span class="panel-label">Before Sending</span>
      ${instructionsHtml || '<p>Review draft, confirm recipients, then execute manually if desired.</p>'}
    </div>
  </div>
</body>
</html>`;

    await preview.loadURL(`data:text/html;charset=utf-8,${encodeURIComponent(html)}`);
    return { success: true };
  });

  registerTrackerPopoutIpc(getMainWindow, popoutWindows);

  ipcMain.handle(IPC_CHANNELS.OPEN_EXTERNAL, async (_event, url) => {
    const normalized = normalizeExternalUrl(url);
    if (!normalized) {
      return { success: false, error: 'Invalid or unsafe URL.' };
    }

    await shell.openExternal(normalized);
    return { success: true, url: normalized };
  });

  ipcMain.handle(IPC_CHANNELS.SHOW_DESKTOP_NOTIFICATION, async (_event, payload) => {
    if (!Notification.isSupported()) {
      return { success: false, error: 'Desktop notifications are not supported on this system.' };
    }

    const title = String(payload?.title || 'FlightDeck');
    const body = String(payload?.body || 'Task update available.');
    const taskId = payload?.taskId ? String(payload.taskId) : null;

    const iconPath = path.join(APP_ROOT, 'icon.png');
    const notification = new Notification({
      title,
      body,
      icon: iconPath,
      urgency: 'normal',
    });

    notification.on('click', () => {
      activeNotifications.delete(notification);
      const mainWindow = getMainWindow();
      if (mainWindow) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.show();
        mainWindow.setAlwaysOnTop(true);
        mainWindow.focus();
        mainWindow.setAlwaysOnTop(false);
        mainWindow.webContents.send(IPC_CHANNELS.NOTIFICATION_CLICKED, { taskId });
      }
    });

    notification.on('close', () => {
      activeNotifications.delete(notification);
    });

    activeNotifications.add(notification);
    notification.show();
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.STORE_GET, (_event, key) => {
    return storeGet(key);
  });

  ipcMain.handle(IPC_CHANNELS.STORE_SET, (_event, key, value) => {
    storeSet(key, value);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.STORE_DELETE, (_event, key) => {
    storeDelete(key);
    return { success: true };
  });

  ipcMain.handle(IPC_CHANNELS.STORE_GET_ALL, () => {
    return storeGetAll();
  });

  ipcMain.handle(IPC_CHANNELS.STORE_GET_SIZE, () => {
    return storeGetSize();
  });

  ipcMain.handle(IPC_CHANNELS.STORE_MIGRATE_FROM_LOCALSTORAGE, (_event, data) => {
    try {
      if (!data || typeof data !== 'object') {
        return { success: false, error: 'Invalid migration data: expected an object.' };
      }
      for (const [key, value] of Object.entries(data)) {
        storeSet(key, value);
      }
      log('[store] Migration from localStorage complete.', Object.keys(data).length, 'keys imported.');
      return { success: true };
    } catch (e) {
      logError('[store] Migration from localStorage failed:', e.message);
      return { success: false, error: e.message };
    }
  });
}

module.exports = { registerIpcHandlers };
