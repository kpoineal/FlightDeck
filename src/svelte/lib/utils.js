/**
 * Escape HTML special characters to prevent XSS.
 * @param {*} value
 * @returns {string}
 */
export function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

/**
 * Parse a date value and return a locale-formatted string, or a fallback.
 * @param {*} value
 * @param {string} fallback
 * @returns {string}
 */
export function safeDate(value, fallback = 'No due date') {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return fallback;
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit',
  });
}

/** Current time as ISO string. */
export function nowIso() {
  return new Date().toISOString();
}

/** FNV-1a hash → 8-char hex string. */
export function hashString(input) {
  const text = String(input || '');
  let hash = 2166136261;
  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0).toString(16).padStart(8, '0');
}

/** Normalize severity label to one of Critical / Elevated / Observe. */
export function normalizeSeverity(value) {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('critical')) return 'Critical';
  if (raw.includes('elevated')) return 'Elevated';
  return 'Observe';
}

/** Parse a value as an ISO date or return null. */
export function toIsoOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  return parsed.toISOString();
}

/** Fix common AI spacing artifacts. */
export function normalizeSpacingArtifacts(value) {
  return String(value || '')
    .replace(/\bTeamschat\b/gi, 'Teams chat')
    .replace(/\bvalueconfirmed\b/gi, 'value confirmed')
    .replace(/\broadmapreview\b/gi, 'roadmap review')
    .replace(/([a-z])([A-Z])/g, '$1 $2')
    .replace(/([A-Z]{2,})([A-Z][a-z])/g, '$1 $2')
    .replace(/([A-Za-z])(\d)/g, '$1 $2')
    .replace(/(\d)([A-Za-z])/g, '$1 $2')
    .replace(/\s{2,}/g, ' ')
    .trim();
}

/** Strip markdown links, citation artifacts, bold markers, and headings. */
export function cleanDisplayText(value) {
  let text = String(value || '');
  text = text.replace(/\[(\d{1,3})\]\((https?:\/\/(?:[^()\s]|\([^()]*\))*)\)/gi, '');
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()]*\))*)\)/gi, '$1');
  text = text.replace(/\[(\d{1,3})\]/g, '');
  text = text.replace(/https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi, '');
  text = text.replace(/\d*\s*\([^)]*%[0-9A-Fa-f][^)]*\)/g, '');
  text = text.replace(/\d*\s*\([^)]*(?:&[A-Za-z]+=|Item\s*Id|exvsurl|viewmodel|web=)[^)]*\)/gi, '');
  text = text.replace(/https?\s*:\s*\/{0,2}[\w\s\-._~:/?#@!$&'*+,;=%]+(?=\)|$)/gi, '');
  text = text.replace(/\d*\s*\(\s*\)/g, '');
  text = text.replace(/\s*\((?:ref:\s*)?turn\d*search\d+\)/gi, '');
  text = text.replace(/^C\d+:\s*/i, '');
  text = text.replace(/\*\*/g, '');
  text = text.replace(/\n*#{1,6}\s+[^\n]*\n*/g, '. ');
  text = text.replace(/([.!?])\s*\. /g, '$1 ');
  text = text.replace(/^\.\s+/, '');
  return normalizeSpacingArtifacts(text);
}

/** Normalize a raw URL string to a sanitized https/http URL or null. */
export function normalizeExternalUrl(value) {
  if (!value) return null;
  let cleaned = String(value)
    .trim()
    .replace(/&amp;/gi, '&')
    .replace(/[\r\n\t\s]+/g, '');
  cleaned = cleaned.replace(/^["'(<\[]+/, '').replace(/["')>\].,;!?]+$/, '');
  const quoteBoundary = cleaned.search(/["'<]/);
  if (quoteBoundary > 0) cleaned = cleaned.slice(0, quoteBoundary);
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
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') return null;
    return parsed.toString();
  } catch {
    return null;
  }
}

const GENERIC_URL_PATTERNS = [
  /^https?:\/\/outlook\.office\.com\/calendar\/?$/i,
  /^https?:\/\/outlook\.office\.com\/mail\/?$/i,
  /^https?:\/\/outlook\.office365\.com\/calendar\/?$/i,
  /^https?:\/\/outlook\.office365\.com\/mail\/?$/i,
  /^https?:\/\/outlook\.office\.com\/?$/i,
  /^https?:\/\/outlook\.office365\.com\/?$/i,
  /^https?:\/\/teams\.microsoft\.com\/?$/i,
  /^https?:\/\/teams\.microsoft\.com\/v2\/?$/i,
  /^https?:\/\/www\.microsoft365\.com\/?$/i,
  /^https?:\/\/sharepoint\.com\/?$/i,
  /^https?:\/\/[a-z0-9-]+\.sharepoint\.com\/?$/i,
  /^https?:\/\/[a-z0-9-]+\.sharepoint\.com\/(?:teams|sites|personal)\/[^/?#]*\/?$/i,
  /^https?:\/\/[a-z0-9-]+-my\.sharepoint\.com\/personal\/[^/?#]*\/?$/i,
  /^https?:\/\/outlook\.office(?:365)?\.com\/mail\/[^?#]*\/id\/?$/i,
  /^https?:\/\/teams\.microsoft\.com\/l\/(?:message|meeting|chat)\/?$/i,
  /\.{3,}$/,
];

export function isGenericUrl(url) {
  if (!url) return true;
  return GENERIC_URL_PATTERNS.some((pattern) => pattern.test(url));
}

const HALLUCINATED_URL_PATTERNS = [
  /turn\d*search\d*/i,
  /\/plain\/turn/i,
  /00000000-0000-0000-0000-000000000000/,
  /example\.com/i,
  /placeholder/i,
  /\bfake\b/i,
  /\bdummy\b/i,
  /\/19:teamsconversation\b/i,
  /\/19:meeting_[A-Za-z]+$/i,
  /message_id_here/i,
  /item_id_here/i,
];

export function isHallucinatedUrl(url) {
  if (!url) return true;
  return HALLUCINATED_URL_PATTERNS.some((pattern) => pattern.test(url));
}

const DEEP_LINK_PATTERNS = [
  /outlook\.office(?:365)?\.com\/(?:mail\/|owa\/)/i,
  /outlook\.office(?:365)?\.com\/calendar\/.+/i,
  /teams\.microsoft\.com\/.*(?:message|chat|thread|conversations|channel)/i,
  /teams\.microsoft\.com\/.*(?:meet|call|l\/meetup-join)/i,
  /teams\.microsoft\.com\/.*(?:recording|video)/i,
  /\.sharepoint\.com\/.*(?::w:|:x:|:p:|:o:|:b:|:v:|:u:|\/Doc\.aspx|\/Documents\/|_layouts)/i,
  /onedrive\.live\.com\/.*(?:cid=|resid=|id=)/i,
  /1drv\.ms\//i,
  /(?:web\.)?microsoftstream\.com\/.+/i,
  /loop\.microsoft\.com\/.+/i,
  /tasks\.office\.com\/.+/i,
  /graph\.microsoft\.com\/.+/i,
];

const SIGNAL_TYPE_DEEP_LINK_PATTERNS = {
  email: [
    /outlook\.office(?:365)?\.com\/(?:mail\/|owa\/)/i,
    /graph\.microsoft\.com\/.+\/messages\//i,
  ],
  chat: [
    /teams\.microsoft\.com\/.*(?:message|chat|thread|conversations|channel)/i,
  ],
  meeting: [
    /teams\.microsoft\.com\/.*(?:meet|call|l\/meetup-join)/i,
    /outlook\.office(?:365)?\.com\/calendar\/.+/i,
  ],
  doc: [
    /\.sharepoint\.com\/.*(?::w:|:x:|:p:|:o:|:b:|:v:|:u:|\/Doc\.aspx|\/Documents\/|_layouts)/i,
    /onedrive\.live\.com\/.*(?:cid=|resid=|id=)/i,
    /1drv\.ms\//i,
    /(?:web\.)?microsoftstream\.com\/.+/i,
    /loop\.microsoft\.com\/.+/i,
    /tasks\.office\.com\/.+/i,
  ],
};

export function normalizeSignalType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'source';
  if (raw.includes('email') || raw.includes('mail')) return 'email';
  if (raw.includes('chat') || raw.includes('teams') || raw.includes('message')) return 'chat';
  if (raw.includes('meeting') || raw.includes('calendar') || raw.includes('call')) return 'meeting';
  if (raw.includes('doc') || raw.includes('document') || raw.includes('file') || raw.includes('sharepoint') || raw.includes('onedrive')) return 'doc';
  return 'source';
}

export function inferSignalTypeFromUrl(url) {
  if (!url) return 'source';
  if (SIGNAL_TYPE_DEEP_LINK_PATTERNS.email.some((p) => p.test(url))) return 'email';
  if (SIGNAL_TYPE_DEEP_LINK_PATTERNS.chat.some((p) => p.test(url))) return 'chat';
  if (SIGNAL_TYPE_DEEP_LINK_PATTERNS.meeting.some((p) => p.test(url))) return 'meeting';
  if (SIGNAL_TYPE_DEEP_LINK_PATTERNS.doc.some((p) => p.test(url))) return 'doc';
  return 'source';
}

export function isDeepLink(url) {
  if (!url) return false;
  if (!/^https:\/\//i.test(url)) return false;
  if (DEEP_LINK_PATTERNS.some((p) => p.test(url))) return true;
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    return path.length > 1;
  } catch {
    return false;
  }
}

export function isSignalTypeDeepLink(type, url) {
  const normalizedUrl = normalizeExternalUrl(url);
  if (!normalizedUrl) return false;
  if (isGenericUrl(normalizedUrl) || isHallucinatedUrl(normalizedUrl) || !isDeepLink(normalizedUrl)) return false;
  const normalizedType = normalizeSignalType(type);
  if (normalizedType === 'source') return true;
  const patterns = SIGNAL_TYPE_DEEP_LINK_PATTERNS[normalizedType];
  return Array.isArray(patterns) && patterns.some((p) => p.test(normalizedUrl));
}

export function compactLinkLabel(url, fallback = 'source') {
  const normalized = normalizeExternalUrl(url);
  if (!normalized) return fallback;
  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./i, '');
    return host.length > 28 ? `${host.slice(0, 25)}...` : host;
  } catch {
    return fallback;
  }
}

export function extractLabelEmbeddedUrl(label) {
  if (!label) return null;
  const raw = String(label);
  const matches = [...raw.matchAll(/\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()]*\))*)\)/gi)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  const url = normalizeExternalUrl(last[2]);
  if (!url) return null;
  const cleanLabel = raw.replace(/\s*\[[^\]]+\]\([^)]+\)/g, '').replace(/\s{2,}/g, ' ').trim();
  return { cleanLabel: cleanLabel || null, url };
}

export function normalizeEvidenceLink(entry, fallbackType = 'source') {
  const isObjectEntry = entry && typeof entry === 'object';
  let rawUrl = isObjectEntry ? entry.url : entry;
  let labelFromExtraction = null;
  if (!rawUrl && isObjectEntry && entry.label) {
    const embedded = extractLabelEmbeddedUrl(entry.label);
    if (embedded) {
      rawUrl = embedded.url;
      labelFromExtraction = embedded.cleanLabel;
    }
  }
  const normalizedUrl = normalizeExternalUrl(rawUrl);
  if (!normalizedUrl) return null;
  const requestedType = isObjectEntry ? entry.type : fallbackType;
  const normalizedType = normalizeSignalType(requestedType || fallbackType);
  if (!isSignalTypeDeepLink(normalizedType, normalizedUrl)) return null;
  const inferredType = inferSignalTypeFromUrl(normalizedUrl);
  const finalType = normalizedType === 'source' && inferredType !== 'source' ? inferredType : normalizedType;
  const rawLabel = labelFromExtraction || (isObjectEntry ? entry.label : null);
  const normalizedLabel = cleanDisplayText(
    rawLabel || compactLinkLabel(normalizedUrl, finalType || 'source')
  ) || compactLinkLabel(normalizedUrl, finalType || 'source');
  const normalizedSignalAt = isObjectEntry
    ? toIsoOrNull(entry.signalAt || entry.sentAt || entry.writtenAt || entry.timestamp)
    : null;
  return {
    label: normalizedLabel,
    type: finalType || 'source',
    url: normalizedUrl,
    ...(normalizedSignalAt ? { signalAt: normalizedSignalAt } : {}),
  };
}

export function extractInlineCitations(text) {
  if (!text) return [];
  const source = String(text);
  const citations = [];
  const seen = new Set();
  const regex = /\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()]*\))*)\)/gi;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const rawLabel = match[1].trim();
    const url = normalizeExternalUrl(match[2]);
    if (!url || seen.has(url)) continue;
    if (isGenericUrl(url) || isHallucinatedUrl(url) || !isDeepLink(url)) continue;
    seen.add(url);
    const inferredType = inferSignalTypeFromUrl(url);
    const isNumericOnly = /^\d+$/.test(rawLabel);
    citations.push({
      label: isNumericOnly ? compactLinkLabel(url, inferredType || 'source') : (rawLabel || compactLinkLabel(url, inferredType || 'source')),
      type: inferredType || 'source',
      url,
    });
  }
  return citations;
}

export function extractBareUrlCitations(text) {
  if (!text) return [];
  const source = String(text);
  const citations = [];
  const seen = new Set();
  const stripped = source.replace(/\[[^\]]+\]\((?:[^()]|\([^()]*\))*\)/g, (m) => ' '.repeat(m.length));
  const bareUrlRegex = /https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi;
  let match;
  while ((match = bareUrlRegex.exec(stripped)) !== null) {
    const url = normalizeExternalUrl(match[0]);
    if (!url || seen.has(url)) continue;
    if (isGenericUrl(url) || isHallucinatedUrl(url) || !isDeepLink(url)) continue;
    seen.add(url);
    const inferredType = inferSignalTypeFromUrl(url);
    citations.push({
      label: compactLinkLabel(url, inferredType || 'source'),
      type: inferredType || 'source',
      url,
    });
  }
  return citations;
}

export function adoptStructuredLabels(inlineLinks, structuredLinks) {
  if (!inlineLinks.length || !Array.isArray(structuredLinks) || !structuredLinks.length) {
    return inlineLinks;
  }
  const labelPool = {};
  for (const entry of structuredLinks) {
    if (!entry || typeof entry !== 'object') continue;
    const label = String(entry.label || '').trim();
    if (!label || label === 'source' || /^\d+$/.test(label)) continue;
    const type = normalizeSignalType(entry.type || 'source');
    if (!labelPool[type]) labelPool[type] = [];
    labelPool[type].push({ label, signalAt: entry.signalAt || null });
  }
  const lastUsedLabel = {};
  const overflowCount = {};
  for (const link of inlineLinks) {
    const pool = labelPool[link.type];
    if (pool && pool.length) {
      const match = pool.shift();
      link.label = match.label;
      lastUsedLabel[link.type] = match.label;
      overflowCount[link.type] = 1;
      if (!link.signalAt && match.signalAt) link.signalAt = match.signalAt;
    } else if (lastUsedLabel[link.type]) {
      overflowCount[link.type] = (overflowCount[link.type] || 1) + 1;
      link.label = `${lastUsedLabel[link.type]} (${overflowCount[link.type]})`;
    } else {
      const fallbackPool = labelPool['source'];
      if (fallbackPool && fallbackPool.length) {
        const match = fallbackPool.shift();
        link.label = match.label;
        lastUsedLabel[link.type] = match.label;
        overflowCount[link.type] = 1;
        if (!link.signalAt && match.signalAt) link.signalAt = match.signalAt;
      } else {
        for (const poolType of Object.keys(labelPool)) {
          if (labelPool[poolType].length) {
            const match = labelPool[poolType].shift();
            link.label = match.label;
            lastUsedLabel[link.type] = match.label;
            overflowCount[link.type] = 1;
            if (!link.signalAt && match.signalAt) link.signalAt = match.signalAt;
            break;
          }
        }
      }
    }
  }
  return inlineLinks;
}

// ── Severity / sorting / grouping helpers ────────────────────────────

export function severityClass(value) {
  const sev = normalizeSeverity(value).toLowerCase();
  if (sev === 'critical') return 'critical';
  if (sev === 'elevated') return 'elevated';
  return 'observe';
}

export function severityRankValue(value) {
  const sev = normalizeSeverity(value).toLowerCase();
  if (sev === 'critical') return 0;
  if (sev === 'elevated') return 1;
  return 2;
}

export function sortBySeverity(items, useHasNewUpdate = false) {
  return [...items].sort((a, b) => {
    const newA = useHasNewUpdate ? ((a.hasNewUpdate === true || a.isNew === true) ? 0 : 1) : 0;
    const newB = useHasNewUpdate ? ((b.hasNewUpdate === true || b.isNew === true) ? 0 : 1) : 0;
    if (newA !== newB) return newA - newB;
    return severityRankValue(a.severity) - severityRankValue(b.severity);
  });
}

export function sortByRecent(items) {
  return [...items].sort((a, b) => {
    const tsA = new Date(a.lastChangedAt || a.lastRunAt || a.discoveredAt || 0).getTime() || 0;
    const tsB = new Date(b.lastChangedAt || b.lastRunAt || b.discoveredAt || 0).getTime() || 0;
    return tsB - tsA;
  });
}

export function relativeTime(value, _now = Date.now()) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const diffMs = _now - parsed.getTime();
  if (diffMs < 0) return 'just now';
  const seconds = Math.floor(diffMs / 1000);
  if (seconds < 60) return 'just now';
  const minutes = Math.floor(seconds / 60);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  if (hours < 24) return `${hours}h ago`;
  const days = Math.floor(hours / 24);
  return `${days}d ago`;
}

export function signalRecencyLabel(value, referenceDate = new Date()) {
  const iso = toIsoOrNull(value);
  if (!iso) return null;
  const parsed = new Date(iso);
  if (!Number.isFinite(parsed.getTime())) return null;
  const now = new Date(referenceDate);
  if (!Number.isFinite(now.getTime())) return null;
  const startOfToday = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const startOfSignalDay = new Date(parsed.getFullYear(), parsed.getMonth(), parsed.getDate());
  const dayDelta = Math.floor((startOfToday.getTime() - startOfSignalDay.getTime()) / (24 * 60 * 60 * 1000));
  if (dayDelta <= 0) return 'today';
  if (dayDelta === 1) return 'yesterday';
  const month = parsed.toLocaleString('en-US', { month: 'short', timeZone: 'UTC' });
  const day = parsed.getUTCDate();
  return parsed.getUTCFullYear() === now.getUTCFullYear()
    ? `${month} ${day}`
    : `${month} ${day}, ${parsed.getUTCFullYear()}`;
}

export function unseenHistoryCount(item) {
  if (!Array.isArray(item?.updateHistory)) return 0;
  return item.updateHistory.filter((e) => e.seen === false).length;
}

export function groupItemsBySource(filteredItems, scannerList) {
  const scannerGroups = new Map();
  const scanners = Array.isArray(scannerList) ? scannerList : [];
  const sortedScanners = [...scanners].sort((a, b) => {
    const aEnabled = a.enabled !== false;
    const bEnabled = b.enabled !== false;
    if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;
    return 0;
  });
  for (const scanner of sortedScanners) {
    scannerGroups.set(scanner.id, { scanner, items: [] });
  }
  for (const item of filteredItems) {
    if (item.scannerId && scannerGroups.has(item.scannerId)) {
      scannerGroups.get(item.scannerId).items.push(item);
    } else if (scannerGroups.size > 0) {
      [...scannerGroups.values()][0].items.push(item);
    }
  }
  return [...scannerGroups.values()];
}

/** Strip markdown, URLs, citation artifacts, and bold markers from briefing text. */
export function sanitizeBriefingText(value) {
  return normalizeSpacingArtifacts(String(value || '')
    .replace(/\[(\d{1,3})\]\((https?:\/\/(?:[^()\s]|\([^()]*\))*)\)/gi, '')
    .replace(/\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()]*\))*)\)/gi, '$1')
    .replace(/https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi, '')
    .replace(/\d*\s*\([^)]*%[0-9A-Fa-f][^)]*\)/g, '')
    .replace(/\d*\s*\([^)]*(?:&[A-Za-z]+=|Item\s*Id|exvsurl|viewmodel|web=)[^)]*\)/gi, '')
    .replace(/https?\s*:\s*\/{0,2}[\w\s\-._~:/?#@!$&'*+,;=%]+(?=\)|$)/gi, '')
    .replace(/\d*\s*\(\s*\)/g, '')
    .replace(/\s*\((?:ref:\s*)?turn\d*search\d+\)/gi, '')
    .replace(/\[(\d{1,3})\]/g, '')
    .replace(/[\s\d)]+$/g, function(m) { return /\d/.test(m) ? '' : m; })
    .replace(/\*\*/g, '')
    .replace(/\n*#{1,6}\s+[^\n]*\n*/g, '. ')
    .replace(/([.!?])\s*\. /g, '$1 ')
    .replace(/^\.\s+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim());
}
