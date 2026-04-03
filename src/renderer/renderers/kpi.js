// ── KPI rendering, severity helpers, and chart rendering ─────────────

function severityClass(value) {
  const sev = normalizeSeverity(value).toLowerCase();
  if (sev === 'critical') return 'critical';
  if (sev === 'elevated') return 'elevated';
  return 'observe';
}

function severityRankValue(value) {
  const sev = normalizeSeverity(value).toLowerCase();
  if (sev === 'critical') return 0;
  if (sev === 'elevated') return 1;
  return 2;
}

function sortBySeverity(items, useHasNewUpdate = false) {
  return [...items].sort((a, b) => {
    const newA = useHasNewUpdate ? ((a.hasNewUpdate === true || a.isNew === true) ? 0 : 1) : 0;
    const newB = useHasNewUpdate ? ((b.hasNewUpdate === true || b.isNew === true) ? 0 : 1) : 0;
    if (newA !== newB) return newA - newB;
    return severityRankValue(a.severity) - severityRankValue(b.severity);
  });
}

function autoSizeSeveritySelects(container) {
  const selects = container.querySelectorAll('.severity-select');
  const measurer = document.createElement('span');
  measurer.classList.add('kpi-measurer');
  document.body.appendChild(measurer);
  selects.forEach((sel) => {
    const text = sel.options[sel.selectedIndex]?.text || '';
    measurer.textContent = text;
    sel.style.setProperty('--sel-width', (measurer.offsetWidth + 28) + 'px');
  });
  document.body.removeChild(measurer);
}

function createEmptySeverityCounts() {
  return { critical: 0, elevated: 0, observe: 0 };
}

function countSeverityFromItems(items) {
  const counts = createEmptySeverityCounts();

  for (const item of items || []) {
    const normalized = normalizeSeverity(item?.severity).toLowerCase();
    if (normalized === 'critical') {
      counts.critical += 1;
    } else if (normalized === 'elevated') {
      counts.elevated += 1;
    } else {
      counts.observe += 1;
    }
  }

  return counts;
}

function getBriefingSeverityCounts() {
  const counts = { briefed: 0, unbriefed: 0 };

  for (const meeting of state.meetings || []) {
    const storedBriefing = state.briefingsByMeetingId[meeting.id] || null;
    const briefing = storedBriefing && isBriefingAlignedWithMeeting(storedBriefing, meeting)
      ? storedBriefing
      : null;
    const status = classifyBriefingSeverity(meeting, briefing);
    counts[status] += 1;
  }

  return counts;
}

function getHistorySeverityCounts() {
  const counts = createEmptySeverityCounts();

  for (const entry of state.history || []) {
    const kind = String(entry.kind || '').toLowerCase();
    if (kind.includes('failure')) {
      counts.critical += 1;
    } else if (kind.includes('recommendation') || kind.includes('confirmation') || kind.includes('execution')) {
      counts.elevated += 1;
    } else {
      counts.observe += 1;
    }
  }

  return counts;
}

function getModeSeverityCounts(mode) {
  if (mode === 'Radar' || mode === 'Tracking') {
    return countSeverityFromItems(state.items);
  }

  if (mode === 'Tracking') {
    return countSeverityFromItems(state.items);
  }

  if (mode === 'Briefings') {
    return getBriefingSeverityCounts();
  }

  if (mode === 'History') {
    return getHistorySeverityCounts();
  }

  return createEmptySeverityCounts();
}

function getModeScopeLabel(mode) {
  if (mode === 'Radar') return 'All Items';
  if (mode === 'Tracking') return 'All Items';
  if (mode === 'Briefings') return 'Meetings Today';
  if (mode === 'History') return 'Audit Events';
  return 'Current View';
}

function renderSummaryStrip(counts, mode) {
  // Update counts
  if (elements.summCriticalCount) elements.summCriticalCount.textContent = String(counts.critical ?? counts.unbriefed ?? 0);
  if (elements.summElevatedCount) elements.summElevatedCount.textContent = String(counts.elevated ?? counts.briefed ?? 0);
  if (elements.summObserveCount) elements.summObserveCount.textContent = String(counts.observe ?? 0);

  // Labels for briefing mode
  const critLabel = elements.summCriticalCount?.parentElement;
  const elevLabel = elements.summElevatedCount?.parentElement;
  const obsLabel = elements.summObserveCount?.parentElement;

  if (mode === 'Briefings') {
    if (critLabel) { critLabel.querySelector('.legend-dot').className = 'legend-dot unbriefed'; critLabel.lastChild.textContent = ' Unbriefed'; }
    if (elevLabel) { elevLabel.querySelector('.legend-dot').className = 'legend-dot briefed'; elevLabel.lastChild.textContent = ' Briefed'; }
    if (obsLabel) obsLabel.classList.add('d-none');
  } else {
    if (critLabel) { critLabel.querySelector('.legend-dot').className = 'legend-dot critical'; critLabel.lastChild.textContent = ' Critical'; }
    if (elevLabel) { elevLabel.querySelector('.legend-dot').className = 'legend-dot elevated'; elevLabel.lastChild.textContent = ' Elevated'; }
    if (obsLabel) { obsLabel.classList.remove('d-none'); }
  }

  // Severity bar
  const total = (counts.critical ?? 0) + (counts.elevated ?? 0) + (counts.observe ?? 0);
  const briefTotal = (counts.unbriefed ?? 0) + (counts.briefed ?? 0);
  const barTotal = mode === 'Briefings' ? briefTotal : total;

  if (elements.summBarCritical) {
    const pct = barTotal ? ((mode === 'Briefings' ? counts.unbriefed : counts.critical) / barTotal * 100) : 0;
    elements.summBarCritical.style.setProperty('--bar-width', pct + '%');
    elements.summBarCritical.className = 'stack-segment ' + (mode === 'Briefings' ? 'unbriefed' : 'critical');
  }
  if (elements.summBarElevated) {
    const pct = barTotal ? ((mode === 'Briefings' ? counts.briefed : counts.elevated) / barTotal * 100) : 0;
    elements.summBarElevated.style.setProperty('--bar-width', pct + '%');
    elements.summBarElevated.className = 'stack-segment ' + (mode === 'Briefings' ? 'briefed' : 'elevated');
  }
  if (elements.summBarMonitor) {
    const pct = barTotal ? ((counts.observe ?? 0) / barTotal * 100) : 0;
    elements.summBarMonitor.style.setProperty('--bar-width', pct + '%');
    elements.summBarMonitor.style.setProperty('--bar-opacity', mode === 'Briefings' ? '0' : '1');
  }

  // Total
  if (elements.summTotal) {
    if (mode === 'Briefings') {
      elements.summTotal.textContent = `${briefTotal} meeting${briefTotal === 1 ? '' : 's'}`;
    } else {
      elements.summTotal.textContent = `${total} item${total === 1 ? '' : 's'}`;
    }
  }

  // Blocked / new counts
  if (elements.summBlocked) {
    const blocked = (state.items || []).filter(i => i.lifecycleStatus === 'blocked').length;
    elements.summBlocked.textContent = blocked > 0 ? `${blocked} blocked` : '';
    elements.summBlocked.style.background = blocked > 0 ? 'color-mix(in srgb, var(--color-critical) 18%, transparent)' : '';
    elements.summBlocked.style.color = blocked > 0 ? 'var(--color-critical)' : '';
  }
  if (elements.summNew) {
    const newCount = (state.items || []).filter(i => (i.isNew || i.hasNewUpdate) && i.lifecycleStatus !== 'complete' && i.lifecycleStatus !== 'archived' && i.lifecycleStatus !== 'snoozed').length;
    elements.summNew.textContent = newCount > 0 ? `${newCount} new` : '';
    elements.summNew.style.background = newCount > 0 ? 'color-mix(in srgb, var(--color-success, #30d158) 15%, transparent)' : '';
    elements.summNew.style.color = newCount > 0 ? 'var(--color-success, #30d158)' : '';
  }
}

function renderKpis() {
  const counts = getModeSeverityCounts(state.mode);
  renderSummaryStrip(counts, state.mode);
}
