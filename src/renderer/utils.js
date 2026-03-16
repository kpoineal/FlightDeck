// ── FlightDeck utility functions ─────────────────────────────────────

function escapeHtml(value) {
  return String(value)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#39;');
}

function normalizeExternalUrl(value) {
  if (!value) return null;
  let cleaned = String(value)
    .trim()
    .replace(/&amp;/gi, '&')
    .replace(/[\r\n\t\s]+/g, '');

  cleaned = cleaned
    .replace(/^["'(<\[]+/, '')
    .replace(/["')>\].,;!?]+$/, '');

  const quoteBoundary = cleaned.search(/["'<]/);
  if (quoteBoundary > 0) {
    cleaned = cleaned.slice(0, quoteBoundary);
  }

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
    if (parsed.protocol !== 'http:' && parsed.protocol !== 'https:') {
      return null;
    }
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
  // SharePoint site/library roots without document paths
  /^https?:\/\/[a-z0-9-]+\.sharepoint\.com\/(?:teams|sites|personal)\/[^/?#]*\/?$/i,
  // OneDrive personal root (no document path)
  /^https?:\/\/[a-z0-9-]+-my\.sharepoint\.com\/personal\/[^/?#]*\/?$/i,
  // Outlook mail with empty or missing message ID
  /^https?:\/\/outlook\.office(?:365)?\.com\/mail\/[^?#]*\/id\/?$/i,
  // Teams paths ending at container level (no specific message/meeting ID)
  /^https?:\/\/teams\.microsoft\.com\/l\/(?:message|meeting|chat)\/?$/i,
  // AI truncation artifacts — URLs ending with triple-dot ellipsis
  /\.{3,}$/,
];

function isGenericUrl(url) {
  if (!url) return true;
  return GENERIC_URL_PATTERNS.some((pattern) => pattern.test(url));
}

// Detect hallucinated / fabricated URLs from LLM citation placeholders.
// These look like real deep links but contain telltale patterns such as
// "turn1search", "turnNsearchN", dummy GUIDs, or placeholder path segments.
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

function isHallucinatedUrl(url) {
  if (!url) return true;
  return HALLUCINATED_URL_PATTERNS.some((pattern) => pattern.test(url));
}

// Only allow evidence links that are actual deep links to specific emails,
// chats, meetings, recordings, or documents.
const DEEP_LINK_PATTERNS = [
  // Outlook – specific email (message id in path or query)
  /outlook\.office(?:365)?\.com\/(?:mail\/|owa\/)/i,
  // Outlook – specific calendar event
  /outlook\.office(?:365)?\.com\/calendar\/.+/i,
  // Teams – specific chat / message / thread
  /teams\.microsoft\.com\/.*(?:message|chat|thread|conversations|channel)/i,
  // Teams – meeting / call link
  /teams\.microsoft\.com\/.*(?:meet|call|l\/meetup-join)/i,
  // Teams – recording / stream
  /teams\.microsoft\.com\/.*(?:recording|video)/i,
  // SharePoint / OneDrive – specific document
  /\.sharepoint\.com\/.*(?::w:|:x:|:p:|:o:|:b:|:v:|:u:|\/Doc\.aspx|\/Documents\/|_layouts)/i,
  // OneDrive direct
  /onedrive\.live\.com\/.*(?:cid=|resid=|id=)/i,
  /1drv\.ms\//i,
  // Stream – specific video/recording
  /(?:web\.)?microsoftstream\.com\/.+/i,
  // Loop / Fluid
  /loop\.microsoft\.com\/.+/i,
  // Planner / To-Do / Tasks deep link
  /tasks\.office\.com\/.+/i,
  // Graph deep link with specific item id
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

function normalizeSignalType(value) {
  const raw = String(value || '').trim().toLowerCase();
  if (!raw) return 'source';
  if (raw.includes('email') || raw.includes('mail')) return 'email';
  if (raw.includes('chat') || raw.includes('teams') || raw.includes('message')) return 'chat';
  if (raw.includes('meeting') || raw.includes('calendar') || raw.includes('call')) return 'meeting';
  if (raw.includes('doc') || raw.includes('document') || raw.includes('file') || raw.includes('sharepoint') || raw.includes('onedrive')) return 'doc';
  return 'source';
}

function inferSignalTypeFromUrl(url) {
  if (!url) return 'source';
  if (SIGNAL_TYPE_DEEP_LINK_PATTERNS.email.some((pattern) => pattern.test(url))) return 'email';
  if (SIGNAL_TYPE_DEEP_LINK_PATTERNS.chat.some((pattern) => pattern.test(url))) return 'chat';
  if (SIGNAL_TYPE_DEEP_LINK_PATTERNS.meeting.some((pattern) => pattern.test(url))) return 'meeting';
  if (SIGNAL_TYPE_DEEP_LINK_PATTERNS.doc.some((pattern) => pattern.test(url))) return 'doc';
  return 'source';
}

function isDeepLink(url) {
  if (!url) return false;
  // Only accept HTTPS links
  if (!/^https:\/\//i.test(url)) return false;
  // Known Microsoft deep-link patterns — always accept
  if (DEEP_LINK_PATTERNS.some((pattern) => pattern.test(url))) return true;
  // Fallback: accept any HTTPS URL with a non-trivial path
  try {
    const parsed = new URL(url);
    const path = parsed.pathname.replace(/\/+$/, '');
    // Must have a real path segment (not just "/" or empty)
    return path.length > 1;
  } catch {
    return false;
  }
}

function isSignalTypeDeepLink(type, url) {
  const normalizedUrl = normalizeExternalUrl(url);
  if (!normalizedUrl) return false;
  if (isGenericUrl(normalizedUrl) || isHallucinatedUrl(normalizedUrl) || !isDeepLink(normalizedUrl)) {
    return false;
  }

  const normalizedType = normalizeSignalType(type);
  if (normalizedType === 'source') {
    return true;
  }

  const patterns = SIGNAL_TYPE_DEEP_LINK_PATTERNS[normalizedType];
  return Array.isArray(patterns) && patterns.some((pattern) => pattern.test(normalizedUrl));
}

function extractExternalUrls(text) {
  const source = String(text || '');
  const urls = [];

  // Allow balanced parentheses in URLs — e.g. (Internal) in SharePoint paths
  const markdownRegex = /\[[^\]]+\]\(((?:[^()\s]|\([^()]*\))*)\)/gi;
  let markdownMatch;
  while ((markdownMatch = markdownRegex.exec(source)) !== null) {
    const normalized = normalizeExternalUrl(markdownMatch[1]);
    if (normalized) urls.push(normalized);
  }

  const bareUrlRegex = /(?:https?:\/\/|[a-z0-9.-]+\.[a-z]{2,}\/)[\w\-._~:/?#[\]@!$&'()*+,;=%]*/gi;
  let bareMatch;
  while ((bareMatch = bareUrlRegex.exec(source)) !== null) {
    const normalized = normalizeExternalUrl(bareMatch[0]);
    if (normalized) urls.push(normalized);
  }

  return [...new Set(urls)];
}

function extractInlineCitations(text) {
  if (!text) return [];
  const source = String(text);
  const citations = [];
  const seen = new Set();
  // Allow balanced parentheses in URLs — e.g. (Internal) in SharePoint paths.
  // Uses (?:[^()\s]|\([^()]*\))* instead of [^)]+ to avoid truncating at
  // literal ) inside URL paths like /Recordings/(Internal)%20...
  const regex = /\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()]*\))*)\)/gi;
  let match;
  while ((match = regex.exec(source)) !== null) {
    const rawLabel = match[1].trim();
    const url = normalizeExternalUrl(match[2]);
    if (!url || seen.has(url)) continue;
    if (isGenericUrl(url) || isHallucinatedUrl(url) || !isDeepLink(url)) continue;
    seen.add(url);
    const inferredType = inferSignalTypeFromUrl(url);
    // Numeric footnote labels ("1", "2") are not descriptive — use domain label instead
    const isNumericOnly = /^\d+$/.test(rawLabel);
    citations.push({
      label: isNumericOnly ? compactLinkLabel(url, inferredType || 'source') : (rawLabel || compactLinkLabel(url, inferredType || 'source')),
      type: inferredType || 'source',
      url,
    });
  }
  return citations;
}

function extractBareUrlCitations(text) {
  if (!text) return [];
  const source = String(text);
  const citations = [];
  const seen = new Set();

  // Replace markdown [label](url) with equal-length whitespace so bare-URL
  // regex below cannot match URLs that are already inside markdown links.
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

/**
 * Adopt descriptive labels from structured evidenceLinks onto inline-extracted
 * citations. The AI often returns good labels in the structured array but with
 * generic/rejected URLs, while inline citations have real deep-link URLs but
 * only numeric/domain labels. This marries the two by matching on signal type.
 *
 * When there are more inline citations than structured labels for a given type,
 * overflow citations get numbered variants of the last consumed label, e.g.
 * "Dayforce migration Teams thread (2)".
 *
 * @param {Array} inlineLinks  — citations from extractInlineCitations / extractBareUrlCitations
 * @param {Array} structuredLinks — raw item.evidenceLinks from the AI payload
 * @returns {Array} inlineLinks with labels upgraded where a match was found
 */
function adoptStructuredLabels(inlineLinks, structuredLinks) {
  if (!inlineLinks.length || !Array.isArray(structuredLinks) || !structuredLinks.length) {
    return inlineLinks;
  }

  // Build a pool of descriptive labels from structured links, grouped by normalized type.
  // Each label is used at most once (consumed on match).
  const labelPool = {};
  for (const entry of structuredLinks) {
    if (!entry || typeof entry !== 'object') continue;
    const label = String(entry.label || '').trim();
    // Skip empty/generic labels
    if (!label || label === 'source' || /^\d+$/.test(label)) continue;
    const type = normalizeSignalType(entry.type || 'source');
    if (!labelPool[type]) labelPool[type] = [];
    labelPool[type].push({ label, signalAt: entry.signalAt || null });
  }

  // Track the last consumed label per type so overflow citations can be numbered
  const lastUsedLabel = {};
  const overflowCount = {};

  for (const link of inlineLinks) {
    const pool = labelPool[link.type];
    if (pool && pool.length) {
      const match = pool.shift();
      link.label = match.label;
      lastUsedLabel[link.type] = match.label;
      overflowCount[link.type] = 1;
      if (!link.signalAt && match.signalAt) {
        link.signalAt = match.signalAt;
      }
    } else if (lastUsedLabel[link.type]) {
      // Pool exhausted but we have a previous label for this type — number it
      overflowCount[link.type] = (overflowCount[link.type] || 1) + 1;
      link.label = `${lastUsedLabel[link.type]} (${overflowCount[link.type]})`;
    } else {
      // Try the generic 'source' pool as fallback
      const fallbackPool = labelPool['source'];
      if (fallbackPool && fallbackPool.length) {
        const match = fallbackPool.shift();
        link.label = match.label;
        lastUsedLabel[link.type] = match.label;
        overflowCount[link.type] = 1;
        if (!link.signalAt && match.signalAt) {
          link.signalAt = match.signalAt;
        }
      } else {
        // Last resort: try any remaining label from any type pool.
        // Handles type mismatches (e.g., structured says "meeting" but
        // inline URL infers "doc" for a SharePoint meeting recording).
        let found = false;
        for (const poolType of Object.keys(labelPool)) {
          if (labelPool[poolType].length) {
            const match = labelPool[poolType].shift();
            link.label = match.label;
            lastUsedLabel[link.type] = match.label;
            overflowCount[link.type] = 1;
            if (!link.signalAt && match.signalAt) {
              link.signalAt = match.signalAt;
            }
            found = true;
            break;
          }
        }
      }
    }
  }

  return inlineLinks;
}

function compactLinkLabel(url, fallback = 'source') {
  const normalized = normalizeExternalUrl(url);
  if (!normalized) {
    return fallback;
  }

  try {
    const parsed = new URL(normalized);
    const host = parsed.hostname.replace(/^www\./i, '');
    return host.length > 28 ? `${host.slice(0, 25)}...` : host;
  } catch {
    return fallback;
  }
}

function renderMarkdownLinks(text) {
  const source = String(text || '');
  const tokenRegex = /\[([^\]]+)\]\(((?:[^()\s]|\([^()]*\))*)\)|((?:https?:\/\/|[a-z0-9.-]+\.[a-z]{2,}\/)[\w\-._~:/?#[\]@!$&'()*+,;=%]*)/gi;
  let output = '';
  let cursor = 0;
  let match;

  while ((match = tokenRegex.exec(source)) !== null) {
    output += escapeHtml(source.slice(cursor, match.index));

    const markdownLabel = match[1];
    const candidateUrl = match[2] || match[3];
    const normalized = normalizeExternalUrl(candidateUrl);

    if (normalized && markdownLabel) {
      const label = String(markdownLabel).trim() || compactLinkLabel(normalized, 'source');
      output += `<a href="${escapeHtml(normalized)}" target="_blank" rel="noopener noreferrer">${escapeHtml(label)}</a>`;
    } else if (normalized) {
      output += `<a href="${escapeHtml(normalized)}" target="_blank" rel="noopener noreferrer">${escapeHtml(compactLinkLabel(normalized, 'link'))}</a>`;
    } else {
      output += escapeHtml(match[0] || '');
    }
    cursor = tokenRegex.lastIndex;
  }

  output += escapeHtml(source.slice(cursor));
  return output.replace(/\n/g, '<br/>');
}

function nowIso() {
  return new Date().toISOString();
}

function hashString(input) {
  const text = String(input || '');
  let hash = 2166136261;

  for (let index = 0; index < text.length; index += 1) {
    hash ^= text.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return (hash >>> 0).toString(16).padStart(8, '0');
}

function safeDate(value, fallback = 'No due date') {
  if (!value) return fallback;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return fallback;
  // Format datetime in a readable format (e.g., "Mar 12, 2026, 3:30 PM")
  return parsed.toLocaleString(undefined, {
    year: 'numeric',
    month: 'short',
    day: 'numeric',
    hour: 'numeric',
    minute: '2-digit'
  });
}

function relativeTime(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) return null;
  const diffMs = Date.now() - parsed.getTime();
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

function normalizeSpacingArtifacts(value) {
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

function cleanDisplayText(value) {
  let text = String(value || '');
  // Strip numeric footnote citation links [N](url) entirely — the label is just a number
  text = text.replace(/\[(\d{1,3})\]\((https?:\/\/(?:[^()\s]|\([^()]*\))*)\)/gi, '');
  // Strip descriptive markdown links [label](url) — keep label only
  text = text.replace(/\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()]*\))*)\)/gi, '$1');
  // Strip footnote-style citations [1], [2] etc.
  text = text.replace(/\[(\d{1,3})\]/g, '');
  // Strip bare URLs
  text = text.replace(/https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi, '');
  // Strip parenthesized blocks containing URL-encoded chars (garbled URL fragments)
  text = text.replace(/\d*\s*\([^)]*%[0-9A-Fa-f][^)]*\)/g, '');
  // Strip parenthesized blocks containing URL query artifacts
  text = text.replace(/\d*\s*\([^)]*(?:&[A-Za-z]+=|Item\s*Id|exvsurl|viewmodel|web=)[^)]*\)/gi, '');
  // Strip malformed URLs with spaces after protocol
  text = text.replace(/https?\s*:\s*\/{0,2}[\w\s\-._~:/?#@!$&'*+,;=%]+(?=\)|$)/gi, '');
  // Strip leftover empty parentheses
  text = text.replace(/\d*\s*\(\s*\)/g, '');
  // Strip LLM search-result reference IDs like (turn1search55), (ref: turn1search40)
  text = text.replace(/\s*\((?:ref:\s*)?turn\d*search\d+\)/gi, '');
  // Strip LLM citation prefixes like "C1: ", "C2: " at start of text
  text = text.replace(/^C\d+:\s*/i, '');
  // Strip bold markers
  text = text.replace(/\*\*/g, '');
  // Strip markdown heading lines — remove the heading marker AND the heading text,
  // inserting a period so the previous sentence has a clean boundary.
  // e.g. "...exit opportunity.\n### Why it matters\nThis is..." → "...exit opportunity. This is..."
  text = text.replace(/\n*#{1,6}\s+[^\n]*\n*/g, '. ');
  // Clean up redundant punctuation from the heading replacement (e.g. ". ." or ".. ")
  text = text.replace(/([.!?])\s*\. /g, '$1 ');
  // Strip any leading ". " if the text started with a heading
  text = text.replace(/^\.\s+/, '');
  return normalizeSpacingArtifacts(text);
}

function sanitizeBriefingText(value) {
  return normalizeSpacingArtifacts(String(value || '')
    // Strip numeric footnote citation links [N](url) entirely
    .replace(/\[(\d{1,3})\]\((https?:\/\/(?:[^()\s]|\([^()]*\))*)\)/gi, '')
    // Strip descriptive markdown links [label](url) → keep label only
    .replace(/\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()]*\))*)\)/gi, '$1')
    // Strip clean bare URLs
    .replace(/https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi, '')
    // Strip parenthesized blocks containing URL-encoded chars (garbled URL fragments)
    .replace(/\d*\s*\([^)]*%[0-9A-Fa-f][^)]*\)/g, '')
    // Strip parenthesized blocks containing URL query artifacts (&key= or ItemId patterns)
    .replace(/\d*\s*\([^)]*(?:&[A-Za-z]+=|Item\s*Id|exvsurl|viewmodel|web=)[^)]*\)/gi, '')
    // Strip malformed URLs with spaces after protocol (safety net for fragments outside parens)
    .replace(/https?\s*:\s*\/{0,2}[\w\s\-._~:/?#@!$&'*+,;=%]+(?=\)|$)/gi, '')
    // Strip leftover empty parentheses from URL removal
    .replace(/\d*\s*\(\s*\)/g, '')
    // Strip LLM search-result reference IDs like (turn1search55), (ref: turn1search40)
    .replace(/\s*\((?:ref:\s*)?turn\d*search\d+\)/gi, '')
    // Strip footnote references [1]
    .replace(/\[(\d{1,3})\]/g, '')
    // Strip trailing orphaned footnote markers (digits, close-parens, spaces at end)
    .replace(/[\s\d)]+$/g, function(m) { return /\d/.test(m) ? '' : m; })
    // Strip bold markers
    .replace(/\*\*/g, '')
    // Strip markdown heading lines (marker + heading text → sentence boundary)
    .replace(/\n*#{1,6}\s+[^\n]*\n*/g, '. ')
    .replace(/([.!?])\s*\. /g, '$1 ')
    .replace(/^\.\s+/, '')
    .replace(/\s{2,}/g, ' ')
    .trim());
}

function normalizeSeverity(value) {
  const raw = String(value || '').toLowerCase();
  if (raw.includes('critical')) return 'Critical';
  if (raw.includes('elevated')) return 'Elevated';
  return 'Observe';
}

function toIsoOrNull(value) {
  if (!value) return null;
  const parsed = new Date(value);
  if (!Number.isFinite(parsed.getTime())) {
    return null;
  }
  return parsed.toISOString();
}

/**
 * Extract a URL embedded as a markdown citation inside a label string.
 * e.g. "Sentinel POC email [1](https://outlook.office365.com/owa/?ItemID=AAMk...)" 
 * Returns { cleanLabel, url } or null if no embedded citation found.
 */
function extractLabelEmbeddedUrl(label) {
  if (!label) return null;
  const raw = String(label);
  // Match the LAST [N](url) in the label (AI may embed multiple; last is most specific)
  const matches = [...raw.matchAll(/\[([^\]]+)\]\((https?:\/\/(?:[^()\s]|\([^()]*\))*)\)/gi)];
  if (!matches.length) return null;
  const last = matches[matches.length - 1];
  const url = normalizeExternalUrl(last[2]);
  if (!url) return null;
  // Strip ALL embedded citations from the label text
  const cleanLabel = raw.replace(/\s*\[[^\]]+\]\([^)]+\)/g, '').replace(/\s{2,}/g, ' ').trim();
  return { cleanLabel: cleanLabel || null, url };
}

function normalizeEvidenceLink(entry, fallbackType = 'source') {
  const isObjectEntry = entry && typeof entry === 'object';

  // Try explicit url field first, then extract from label if missing
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
  if (!isSignalTypeDeepLink(normalizedType, normalizedUrl)) {
    return null;
  }

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

function signalRecencyLabel(value, referenceDate = new Date()) {
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

function normalizeMultilineText(value) {
  return String(value || '')
    .split(/\r?\n/)
    .map((line) => normalizeSpacingArtifacts(line))
    .join('\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}
