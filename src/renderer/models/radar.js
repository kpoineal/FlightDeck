// ── Radar-item model logic ─────────────────────────────────────────

function applyRadarPayload(payload) {
  const kpis = payload.kpis || {};
  state.kpis = {
    critical: Number(kpis.critical || 0),
    elevated: Number(kpis.elevated || 0),
    observe: Number(kpis.observe || kpis.monitor || 0),
  };

  const mappedRadarItems = (payload.radarItems || []).map((item) => {
    // Extract inline citations from raw text BEFORE cleaning strips them
    const inlineLinks = [
      ...extractInlineCitations(item.summary || ''),
      ...extractInlineCitations(item.reason || ''),
    ];
    // Fallback: extract bare URLs if no markdown citations found
    if (!inlineLinks.length) {
      inlineLinks.push(
        ...extractBareUrlCitations(item.summary || ''),
        ...extractBareUrlCitations(item.reason || ''),
      );
    }
    // Adopt descriptive labels from structured evidenceLinks (which often
    // have good labels but generic/rejected URLs)
    adoptStructuredLabels(inlineLinks, item.evidenceLinks);

    return {
      id: resolveRadarItemId(item),
      title: cleanDisplayText(item.title || 'Untitled item'),
      severity: normalizeSeverity(item.severity),
      sourceType: item.sourceType || 'Signal',
      dueAt: item.dueAt || null,
      owner: cleanDisplayText(item.owner || 'You'),
      counterparties: Array.isArray(item.counterparties) ? item.counterparties.map(cleanDisplayText) : [],
      summary: cleanDisplayText(item.summary || ''),
      reason: cleanDisplayText(item.reason || ''),
      status: item.status || 'Inbound',
      evidenceLinks: (() => {
        const links = [];
        const seenUrls = new Set();
        // Structured evidenceLinks first (they have signalAt metadata)
        for (const entry of (Array.isArray(item.evidenceLinks) ? item.evidenceLinks : [])) {
          const normalized = normalizeEvidenceLink(entry, item.sourceType || 'source');
          if (!normalized || seenUrls.has(normalized.url)) continue;
          links.push(normalized);
          seenUrls.add(normalized.url);
        }
        // Then inline-extracted links (fill gaps)
        for (const entry of inlineLinks) {
          if (!entry.url || seenUrls.has(entry.url)) continue;
          links.push(entry);
          seenUrls.add(entry.url);
        }
        // Last resort: if we have ZERO links but the AI gave structured
        // evidenceLinks with descriptive labels (even with generic URLs or
        // label-embedded citations), keep them.
        if (!links.length) {
          for (const entry of (Array.isArray(item.evidenceLinks) ? item.evidenceLinks : [])) {
            if (!entry || typeof entry !== 'object') continue;
            // Try explicit url, then extract from label
            let url = normalizeExternalUrl(entry.url);
            let label = cleanDisplayText(entry.label || '');
            if (!url && entry.label) {
              const embedded = extractLabelEmbeddedUrl(entry.label);
              if (embedded) {
                url = embedded.url;
                if (embedded.cleanLabel) label = cleanDisplayText(embedded.cleanLabel);
              }
            }
            if (!url || isHallucinatedUrl(url) || seenUrls.has(url)) continue;
            label = label || compactLinkLabel(url, 'source');
            seenUrls.add(url);
            links.push({
              label,
              type: normalizeSignalType(entry.type || item.sourceType || 'source'),
              url,
              ...(toIsoOrNull(entry.signalAt) ? { signalAt: toIsoOrNull(entry.signalAt) } : {}),
            });
          }
        }
        return links;
      })(),
      suggestedNextSteps: Array.isArray(item.suggestedNextSteps)
        ? item.suggestedNextSteps.map(cleanDisplayText).filter(Boolean).slice(0, 2)
        : [],
    };
  });

  state.radarItems = mappedRadarItems;
  state.actions = [];
  state.evidence = [];

  // Merge new evidence links from radar into already-tracked items
  for (const radarItem of mappedRadarItems) {
    if (!radarItem.evidenceLinks || !radarItem.evidenceLinks.length) continue;
    const tracked = state.trackingItems.find((entry) => entry.id === radarItem.id);
    if (!tracked) continue;
    if (!Array.isArray(tracked.evidenceLinks)) tracked.evidenceLinks = [];
    const existingUrls = new Set(tracked.evidenceLinks.map((e) => e.url));
    for (const link of radarItem.evidenceLinks) {
      if (link && link.url && !existingUrls.has(link.url)) {
        tracked.evidenceLinks.push(link);
        existingUrls.add(link.url);
      }
    }
  }



  applyLedgerPayload(payload);

  if (state.selectedRadarItemId && !state.radarItems.some((item) => item.id === state.selectedRadarItemId)) {
    state.selectedRadarItemId = null;
  }

  if (!state.selectedRadarItemId) {
    const inbound = getInboundRadarItems();
    if (inbound.length) {
      state.selectedRadarItemId = inbound[0].id;
    }
  }
}

function mapLedgerEntryToRadarItem(entry, bucketLabel, severity, owner) {
  const normalizedId = `${bucketLabel.toLowerCase().replace(/\s+/g, '_')}_${entry.id || Math.random().toString(16).slice(2, 8)}`;
  return {
    id: `ledger_${normalizedId}`,
    title: cleanDisplayText(entry.title || 'Ledger item'),
    severity,
    sourceType: 'Ledger',
    dueAt: entry.dueAt || null,
    owner: cleanDisplayText(owner),
    counterparties: Array.isArray(entry.counterparties) ? entry.counterparties.map(cleanDisplayText) : [],
    summary: cleanDisplayText(entry.suggestedFollowUp || 'Commitment requires tracking.'),
    reason: `Ledger item (${bucketLabel})`,
    status: bucketLabel,
    ledgerEvidenceLinks: Array.isArray(entry.evidenceLinks) ? entry.evidenceLinks : [],
    isLedger: true,
  };
}

function getUnifiedRadarItems() {
  const radarItems = Array.isArray(state.radarItems) ? state.radarItems : [];
  const ledgerItems = [
    ...(state.ledger.iOwe || []).map((entry) => mapLedgerEntryToRadarItem(entry, 'I owe', 'Elevated', 'You')),
    ...(state.ledger.othersOweMe || []).map((entry) => mapLedgerEntryToRadarItem(entry, 'Owed to me', 'Elevated', 'Counterparty')),
    ...(state.ledger.silentThreads || []).map((entry) => mapLedgerEntryToRadarItem(entry, 'Silent', 'Observe', 'Counterparty')),
  ];

  return [...radarItems, ...ledgerItems];
}

function applyLedgerPayload(payload) {
  const normalizeLedgerEntry = (item, index, prefix) => ({
    id: item.id || `${prefix}_${index + 1}`,
    title: cleanDisplayText(item.title || 'Untitled'),
    counterparties: Array.isArray(item.counterparties) ? item.counterparties.map(cleanDisplayText) : [],
    dueAt: item.dueAt || null,
    lastSignalAt: item.lastSignalAt || null,
    daysSilent: Number(item.daysSilent || 0),
    evidenceLinks: Array.isArray(item.evidenceLinks)
      ? (() => {
          const links = [];
          const seenUrls = new Set();
          for (const value of item.evidenceLinks) {
            const normalized = normalizeEvidenceLink(value, 'source');
            if (!normalized || seenUrls.has(normalized.url)) continue;
            links.push(normalized);
            seenUrls.add(normalized.url);
          }
          return links;
        })()
      : [],
    suggestedFollowUp: cleanDisplayText(item.suggestedFollowUp || ''),
  });

  state.ledger = {
    iOwe: Array.isArray(payload.iOwe) ? payload.iOwe.map((entry, index) => normalizeLedgerEntry(entry, index, 'iowe')) : [],
    othersOweMe: Array.isArray(payload.othersOweMe)
      ? payload.othersOweMe.map((entry, index) => normalizeLedgerEntry(entry, index, 'others'))
      : [],
    silentThreads: Array.isArray(payload.silentThreads)
      ? payload.silentThreads.map((entry, index) => normalizeLedgerEntry(entry, index, 'silent'))
      : [],
  };
}

function radarItemIdentitySeed(item) {
  const title = cleanDisplayText(item?.title || '').toLowerCase();
  const sourceType = cleanDisplayText(item?.sourceType || '').toLowerCase();
  const dueAt = String(item?.dueAt || '').trim().toLowerCase();
  const owner = cleanDisplayText(item?.owner || '').toLowerCase();
  const summary = cleanDisplayText(item?.summary || '').toLowerCase();
  const reason = cleanDisplayText(item?.reason || '').toLowerCase();
  const counterparties = Array.isArray(item?.counterparties)
    ? item.counterparties.map((name) => cleanDisplayText(name).toLowerCase()).join(',')
    : '';

  return [title, sourceType, dueAt, owner, summary, reason, counterparties].join('|');
}

function resolveRadarItemId(item) {
  // Always use content-based hashing — AI-provided ids like "radar-001"
  // are not globally unique and cause cross-scan collisions.
  const stableSeed = radarItemIdentitySeed(item);
  if (!stableSeed.replace(/\|/g, '')) {
    return `radar_${hashString(nowIso())}`;
  }

  return `radar_${hashString(stableSeed)}`;
}

function primaryEvidenceLinkForRadar(item) {
  if (!item) return null;

  const linkedByRadar = state.evidence.filter((entry) => entry.radarItemId === item.id && entry.citationUrl);
  if (linkedByRadar.length) {
    return linkedByRadar[0];
  }

  if (Array.isArray(item.evidenceIds) && item.evidenceIds.length) {
    const linkedById = state.evidence.find((entry) => item.evidenceIds.includes(entry.id) && entry.citationUrl);
    if (linkedById) {
      return linkedById;
    }
  }

  return null;
}

function collectRadarSourceLinks(item) {
  const links = [];

  // 1. Evidence from state.evidence (if populated)
  const evidence = primaryEvidenceLinkForRadar(item);
  if (evidence?.citationUrl) {
    links.push({
      label: evidence.label || 'source',
      type: evidence.type || 'source',
      url: evidence.citationUrl,
      ...(toIsoOrNull(evidence.signalAt || evidence.timestamp) ? { signalAt: toIsoOrNull(evidence.signalAt || evidence.timestamp) } : {}),
    });
  }

  // 2. Structured evidenceLinks on the radar item itself
  if (Array.isArray(item.evidenceLinks)) {
    for (const entry of item.evidenceLinks) {
      if (entry && entry.url && !links.some((l) => l.url === entry.url)) {
        links.push({
          label: entry.label || 'source',
          type: entry.type || 'source',
          url: entry.url,
          ...(entry.signalAt ? { signalAt: entry.signalAt } : {}),
        });
      }
    }
  }

  // 3. Ledger evidence links (for ledger-sourced radar items)
  if (Array.isArray(item.ledgerEvidenceLinks)) {
    for (const entry of item.ledgerEvidenceLinks) {
      const entryUrl = (entry && typeof entry === 'object') ? entry.url : entry;
      const entryLabel = (entry && typeof entry === 'object') ? (entry.label || 'source') : compactLinkLabel(entryUrl, 'source');
      const entryType = (entry && typeof entry === 'object') ? (entry.type || 'source') : 'source';
      const entrySignalAt = (entry && typeof entry === 'object') ? entry.signalAt : null;
      if (entryUrl && !links.some((l) => l.url === entryUrl)) {
        links.push({
          label: entryLabel,
          type: entryType,
          url: entryUrl,
          ...(entrySignalAt ? { signalAt: entrySignalAt } : {}),
        });
      }
    }
  }

  return links;
}

function isInboundStatus(status) {
  return String(status || 'Inbound').toLowerCase() === 'inbound';
}

function getInboundRadarItems() {
  const radarItems = Array.isArray(state.radarItems) ? state.radarItems : [];
  const trackedIds = new Set(state.trackingItems.map((entry) => entry.id));
  const filtered = radarItems.filter((item) => isInboundStatus(item.status) && !trackedIds.has(item.id));
  return sortBySeverity(filtered);
}
