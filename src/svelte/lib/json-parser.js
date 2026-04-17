// ── FlightDeck JSON parsing (ES module) ──────────────────────────────

/**
 * Extract JSON candidate strings from a text response using multiple strategies.
 */
export function extractJsonFromText(text) {
  if (!text) return [];
  const trimmed = String(text).trim();
  const candidates = [];

  // Strategy 1: text starts with JSON
  if (trimmed.startsWith('{') || trimmed.startsWith('[')) {
    candidates.push(trimmed);
  }

  // Strategy 2: fenced code blocks
  const fencedRegex = /```(?:json)?\s*([\s\S]*?)\s*```/gi;
  let match;
  while ((match = fencedRegex.exec(trimmed)) !== null) {
    if (match[1]) candidates.push(match[1].trim());
  }

  // Strategy 3: first-brace to last-brace slice
  const firstBrace = trimmed.indexOf('{');
  const lastBrace = trimmed.lastIndexOf('}');
  if (firstBrace >= 0 && lastBrace > firstBrace) {
    candidates.push(trimmed.slice(firstBrace, lastBrace + 1));
  }

  return [...new Set(candidates.filter(Boolean))];
}

/**
 * Normalize a JSON candidate by stripping ANSI codes, fixing smart quotes,
 * removing control characters, and stripping trailing commas.
 */
function normalizeJsonCandidate(text) {
  return String(text)
    .replace(/\u001b\][^\u0007\u001b]*(?:\u0007|\u001b\\)/g, '')
    .replace(/\x1b\][^\x07\x1b]*(?:\x07|\x1b\\)/g, '')
    .replace(/[\u201C\u201D]/g, '"')
    .replace(/[\u2018\u2019]/g, "'")
    .replace(/[\x00-\x08\x0B\x0C\x0E-\x1F\x7F]/g, '')
    .replace(/,\s*([}\]])/g, '$1')
    .trim();
}

/**
 * Repair likely-broken JSON by replacing unescaped interior quotes with
 * single quotes, collapsing newlines inside strings, etc.
 */
export function sanitizeLikelyBrokenJson(input) {
  let output = '';
  let inString = false;
  let escapeNext = false;

  for (let index = 0; index < input.length; index += 1) {
    const char = input[index];

    if (escapeNext) {
      output += char;
      escapeNext = false;
      continue;
    }

    if (char === '\\') {
      output += char;
      if (inString) {
        escapeNext = true;
      }
      continue;
    }

    if (char === '"') {
      if (!inString) {
        inString = true;
        output += char;
        continue;
      }

      let lookahead = index + 1;
      while (lookahead < input.length && /\s/.test(input[lookahead])) {
        lookahead += 1;
      }

      const next = input[lookahead] || '';
      const looksLikeStringTerminator = next === ',' || next === '}' || next === ']' || next === ':';

      if (looksLikeStringTerminator) {
        inString = false;
        output += char;
      } else {
        output += "'";
      }

      continue;
    }

    if (inString && (char === '\n' || char === '\r')) {
      output += ' ';
      continue;
    }

    output += char;
  }

  return output
    .replace(/\s{2,}/g, ' ')
    .replace(/\uFFFD/g, '')
    .trim();
}

/**
 * Attempt to parse JSON with progressive repair strategies:
 * 1. Normalize and parse directly
 * 2. Collapse whitespace and retry
 * 3. Sanitize broken quotes and retry
 */
function parseJsonWithRepair(text) {
  const normalized = normalizeJsonCandidate(text);
  try {
    return JSON.parse(normalized);
  } catch {
    const repaired = normalized
      .replace(/\r?\n/g, ' ')
      .replace(/\s{2,}/g, ' ')
      .trim();

    try {
      return JSON.parse(repaired);
    } catch {
      const repairedWithQuoteFix = sanitizeLikelyBrokenJson(repaired);
      return JSON.parse(repairedWithQuoteFix);
    }
  }
}

/**
 * Extract markdown footnote citation URLs from text surrounding the JSON.
 * WorkIQ often returns citations as `[1](url)` after the JSON block.
 */
function extractFootnoteCitations(text) {
  if (!text) return [];
  const citations = [];
  const seen = new Set();
  const footnoteRegex = /\[(\d+)\]\((https?:\/\/(?:[^()\s]|\([^()]*\))*)\)/gi;
  let match;
  while ((match = footnoteRegex.exec(text)) !== null) {
    const index = parseInt(match[1], 10);
    const url = match[2];
    if (url && !seen.has(url)) {
      seen.add(url);
      citations.push({ index, url });
    }
  }
  return citations;
}

/**
 * After parsing JSON, check if citation footnotes exist in the raw text
 * and inject them into radarItems or other structures that have empty
 * evidenceLinks arrays.
 */
function injectFootnoteCitations(parsed, rawText) {
  if (!parsed || !rawText) return parsed;

  const citations = extractFootnoteCitations(rawText);
  if (!citations.length) return parsed;

  // Inject into radarItems
  if (Array.isArray(parsed.radarItems)) {
    const emptyItems = parsed.radarItems.filter(
      (item) => !item.evidenceLinks || !item.evidenceLinks.length
    );

    if (emptyItems.length > 0) {
      let citationIdx = 0;
      for (const item of emptyItems) {
        if (citationIdx >= citations.length) break;
        if (!item.evidenceLinks) item.evidenceLinks = [];
        const citation = citations[citationIdx];
        const sourceLabel = item.sourceType
          ? `${item.sourceType} source for: ${(item.title || 'item').slice(0, 60)}`
          : `Source ${citation.index}`;
        item.evidenceLinks.push({
          label: sourceLabel,
          type: (item.sourceType || 'source').toLowerCase(),
          url: citation.url,
        });
        citationIdx += 1;
      }
    }

    // Also try to match remaining citations to items without links
    if (citations.length > emptyItems.length) {
      let remainingIdx = emptyItems.length;
      for (const item of parsed.radarItems) {
        if (remainingIdx >= citations.length) break;
        if (item.evidenceLinks && item.evidenceLinks.length > 0) continue;
      }
    }
  }

  // Inject into ledger entries (iOwe, othersOweMe, silentThreads)
  for (const ledgerKey of ['iOwe', 'othersOweMe', 'silentThreads']) {
    const entries = parsed[ledgerKey];
    if (!Array.isArray(entries)) continue;
    for (const entry of entries) {
      if (!entry.evidenceLinks) entry.evidenceLinks = [];
    }
  }

  return parsed;
}

/**
 * Parse a WorkIQ answer string as JSON, trying all candidate extraction
 * strategies and repair passes. Validates with the provided validator.
 */
function parseWorkiqJson(answer, validator) {
  const candidates = extractJsonFromText(answer);
  for (const candidate of candidates) {
    try {
      const parsed = parseJsonWithRepair(candidate);
      if (validator(parsed)) {
        return injectFootnoteCitations(parsed, answer);
      }
    } catch {
      continue;
    }
  }
  throw new Error('Response JSON could not be parsed.');
}

/**
 * Detect if a WorkIQ response is actually a EULA acceptance prompt.
 */
function looksLikeEulaPrompt(text) {
  if (!text) return false;
  const lower = String(text).toLowerCase();
  return lower.includes('accept the end user license') ||
         lower.includes('workiq accept-eula') ||
         (lower.includes('eula') && lower.includes('accept'));
}

// Track parse failures per label for debugging diagnostics
const _parseFailureCounts = {};

/**
 * Send a prompt to WorkIQ, extract and validate JSON from the response.
 * Retries on parse failure and detects EULA/auth errors.
 *
 * @param {string} prompt - The prompt to send
 * @param {function} validator - Validates parsed JSON; return true if valid
 * @param {string} label - Label for logging/diagnostics
 * @param {object} [options]
 * @param {number} [options.maxRetries=1]
 * @param {number} [options.retryDelayMs=2000]
 * @param {function} [options.onRetry]
 * @returns {Promise<object>} Parsed and validated JSON payload
 */
export async function runWorkiqJson(prompt, validator, label, { maxRetries = 1, retryDelayMs = 2000, onRetry } = {}) {
  let lastError;

  for (let attempt = 0; attempt <= maxRetries; attempt += 1) {
    if (attempt > 0) {
      console.warn(`[flightdeck] ${label}: retry ${attempt}/${maxRetries} after parse failure`);
      if (typeof onRetry === 'function') onRetry(attempt, maxRetries);
      await new Promise((r) => setTimeout(r, retryDelayMs));
    }

    const result = await window.workiq.ask(prompt);
    const raw = result.success ? result.answer : result.error;
    console.log(`[flightdeck] ${label} raw response (attempt ${attempt + 1}):`, raw);

    // Detect EULA gate: WorkIQ returns EULA text instead of data
    if (looksLikeEulaPrompt(raw)) {
      console.warn(`[flightdeck] ${label}: WorkIQ returned EULA prompt — resetting connection`);
      throw new Error('WorkIQ EULA not accepted. Click "Enable WorkIQ" to accept and reconnect.');
    }

    if (!result.success) {
      throw new Error(result.error || `${label} query failed.`);
    }

    try {
      return parseWorkiqJson(result.answer, validator);
    } catch (parseErr) {
      _parseFailureCounts[label] = (_parseFailureCounts[label] || 0) + 1;
      console.warn(
        `[flightdeck] ${label}: parse failure #${_parseFailureCounts[label]} (attempt ${attempt + 1}/${maxRetries + 1})`,
        parseErr.message
      );
      lastError = parseErr;
    }
  }

  throw new Error(`Scan returned an unexpected response. Will try again on next refresh.`);
}
