const { shell } = require('electron');
const fs = require('fs');
const path = require('path');

let logStream = null;

function initLogFile(logDir) {
  fs.mkdirSync(logDir, { recursive: true });
  const logPath = path.join(logDir, 'flightdeck.log');
  logStream = fs.createWriteStream(logPath, { flags: 'a' });
}

function ts() {
  return new Date().toISOString();
}

function formatArgs(args) {
  return args.map(a => (typeof a === 'string' ? a : JSON.stringify(a))).join(' ');
}

function log(...args) {
  const line = `[${ts()}] ${formatArgs(args)}`;
  console.log(line);
  if (logStream) logStream.write(line + '\n');
}

function logError(...args) {
  const line = `[${ts()}] [ERROR] ${formatArgs(args)}`;
  console.error(line);
  if (logStream) logStream.write(line + '\n');
}

function normalizeExternalUrl(url) {
  if (!url) return null;
  let cleaned = String(url)
    .trim()
    .replace(/&amp;/gi, '&')
    .replace(/[\r\n\t\s]+/g, '');

  if (!/^https?:\/\//i.test(cleaned)) {
    const looksLikeDomainPath = /^[a-z0-9.-]+\.[a-z]{2,}(?:[/:?#]|$)/i.test(cleaned);
    if (looksLikeDomainPath) {
      cleaned = `https://${cleaned}`;
    } else {
      return null;
    }
  }

  try {
    const parsed = new URL(cleaned);
    if (parsed.protocol === 'https:' || parsed.protocol === 'http:') {
      return parsed.toString();
    }
    return null;
  } catch {
    return null;
  }
}

function isSafeExternalUrl(url) {
  try {
    return Boolean(normalizeExternalUrl(url));
  } catch {
    return false;
  }
}

function attachExternalNavigationGuards(win) {
  win.webContents.setWindowOpenHandler(({ url }) => {
    const normalized = normalizeExternalUrl(url);
    if (normalized) {
      shell.openExternal(normalized);
    }
    return { action: 'deny' };
  });

  win.webContents.on('will-navigate', (event, url) => {
    const normalized = normalizeExternalUrl(url);
    if (url !== win.webContents.getURL() && normalized) {
      event.preventDefault();
      shell.openExternal(normalized);
    }
  });
}

function getRuntimeWindowIcon(appRoot) {
  if (process.platform === 'win32') {
    const icoPath = path.join(appRoot, '..', 'build', 'icon.ico');
    if (fs.existsSync(icoPath)) return icoPath;
  }
  return path.join(appRoot, 'icon.png');
}

function applyRuntimeWindowIcon(win, appRoot) {
  const iconPath = getRuntimeWindowIcon(appRoot);
  if ((process.platform === 'win32' || process.platform === 'linux') && typeof win.setIcon === 'function') {
    win.setIcon(iconPath);
  }
  return iconPath;
}

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function markdownToHtml(markdown) {
  const lines = String(markdown || '').split(/\r?\n/);
  const html = [];
  let inList = false;

  const closeList = () => {
    if (inList) {
      html.push('</ul>');
      inList = false;
    }
  };

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();

    if (!line.trim()) {
      closeList();
      continue;
    }

    const heading = line.match(/^(#{1,3})\s+(.*)$/);
    if (heading) {
      closeList();
      const level = heading[1].length;
      html.push(`<h${level}>${escapeHtml(heading[2])}</h${level}>`);
      continue;
    }

    const bullet = line.match(/^[-*]\s+(.*)$/);
    if (bullet) {
      if (!inList) {
        html.push('<ul>');
        inList = true;
      }
      html.push(`<li>${escapeHtml(bullet[1])}</li>`);
      continue;
    }

    closeList();
    html.push(`<p>${escapeHtml(line)}</p>`);
  }

  closeList();
  return html.join('\n');
}

module.exports = {
  ts,
  log,
  logError,
  initLogFile,
  normalizeExternalUrl,
  isSafeExternalUrl,
  attachExternalNavigationGuards,
  getRuntimeWindowIcon,
  applyRuntimeWindowIcon,
  escapeHtml,
  markdownToHtml,
};
