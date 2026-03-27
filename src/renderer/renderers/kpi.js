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

function updateLegendEntry(countEl, dotClass, label, value, visible) {
  if (!countEl) return;
  countEl.textContent = String(value);
  const span = countEl.parentElement;
  if (!span) return;
  span.classList.toggle('d-none', !visible);
  const dot = span.querySelector('.legend-dot');
  if (dot) dot.className = 'legend-dot ' + dotClass;
  for (const child of span.childNodes) {
    if (child.nodeType === 3 && child.textContent.includes(':')) {
      child.textContent = label + ': ';
      break;
    }
  }
}

function renderSeverityCharts(counts, mode) {
  if (!elements.severityBarCritical || !elements.severityBarElevated || !elements.severityBarMonitor) {
    return;
  }

  const legendContainer = elements.chartCriticalCount?.closest('.viz-legend');

  if (mode === 'Briefings') {
    const total = (counts.briefed || 0) + (counts.unbriefed || 0);
    const unbriefedPct = total ? (counts.unbriefed / total) * 100 : 0;
    const briefedPct = total ? (counts.briefed / total) * 100 : 0;

    elements.severityBarCritical.className = 'stack-segment unbriefed';
    elements.severityBarCritical.style.setProperty('--bar-width', `${unbriefedPct}%`);
    elements.severityBarCritical.style.setProperty('--bar-opacity', counts.unbriefed ? '1' : '0.25');

    elements.severityBarElevated.className = 'stack-segment briefed';
    elements.severityBarElevated.style.setProperty('--bar-width', `${briefedPct}%`);
    elements.severityBarElevated.style.setProperty('--bar-opacity', counts.briefed ? '1' : '0.25');

    elements.severityBarMonitor.style.setProperty('--bar-width', '0%');
    elements.severityBarMonitor.style.setProperty('--bar-opacity', '0');

    updateLegendEntry(elements.chartCriticalCount, 'unbriefed', 'Unbriefed', counts.unbriefed, true);
    updateLegendEntry(elements.chartElevatedCount, 'briefed', 'Briefed', counts.briefed, true);
    updateLegendEntry(elements.chartMonitorCount, 'observe', 'Observe', 0, false);
    if (legendContainer) legendContainer.classList.add('viz-legend--briefing');

    if (elements.chartTotalItems) elements.chartTotalItems.textContent = `${total} meeting${total === 1 ? '' : 's'}`;

    if (elements.severityDonut) {
      const u = Math.round(unbriefedPct);
      const gradient = total
        ? `conic-gradient(#6076ab 0% ${u}%, #48d5ff ${u}% 100%)`
        : `conic-gradient(var(--bg-donut-track) 0% 100%)`;
      elements.severityDonut.style.setProperty('--donut-bg', gradient);
      elements.severityDonut.dataset.total = String(total);
    }

    if (elements.severityInsight) {
      if (!total) {
        elements.severityInsight.textContent = `No meetings in ${getModeScopeLabel(mode)}.`;
      } else {
        const pct = Math.round((counts.briefed / total) * 100);
        elements.severityInsight.textContent = `${pct}% of meetings are briefed.`;
      }
    }
    return;
  }

  // 3-tier severity for Radar / Tracking / History
  elements.severityBarCritical.className = 'stack-segment critical';
  elements.severityBarElevated.className = 'stack-segment elevated';
  elements.severityBarMonitor.className = 'stack-segment observe';

  const total = counts.critical + counts.elevated + counts.observe;
  const criticalPct = total ? (counts.critical / total) * 100 : 0;
  const elevatedPct = total ? (counts.elevated / total) * 100 : 0;
  const observePct = total ? (counts.observe / total) * 100 : 0;

elements.severityBarCritical.style.setProperty('--bar-width', `${criticalPct}%`);
    elements.severityBarElevated.style.setProperty('--bar-width', `${elevatedPct}%`);
    elements.severityBarMonitor.style.setProperty('--bar-width', `${observePct}%`);

    elements.severityBarCritical.style.setProperty('--bar-opacity', counts.critical ? '1' : '0.25');
    elements.severityBarElevated.style.setProperty('--bar-opacity', counts.elevated ? '1' : '0.25');
    elements.severityBarMonitor.style.setProperty('--bar-opacity', counts.observe ? '1' : '0.25');

  updateLegendEntry(elements.chartCriticalCount, 'critical', 'Critical', counts.critical, true);
  updateLegendEntry(elements.chartElevatedCount, 'elevated', 'Elevated', counts.elevated, true);
  updateLegendEntry(elements.chartMonitorCount, 'observe', 'Observe', counts.observe, true);
if (legendContainer) legendContainer.classList.remove('viz-legend--briefing');

  if (elements.chartTotalItems) elements.chartTotalItems.textContent = `${total} item${total === 1 ? '' : 's'}`;

  if (elements.severityDonut) {
    const c = Math.round(criticalPct);
    const e = Math.round(elevatedPct);
    const gradient = total
      ? `conic-gradient(#ff2d97 0% ${c}%, #48d5ff ${c}% ${c + e}%, #6076ab ${c + e}% 100%)`
      : `conic-gradient(var(--bg-donut-track) 0% 100%)`;
      elements.severityDonut.style.setProperty('--donut-bg', gradient);
    elements.severityDonut.dataset.total = String(total);
  }

  if (elements.severityInsight) {
    if (!total) {
      elements.severityInsight.textContent = `No classified items in ${getModeScopeLabel(mode)}.`;
      return;
    }

    const dominant = [
      ['Critical', counts.critical],
      ['Elevated', counts.elevated],
      ['Observe', counts.observe],
    ].sort((a, b) => b[1] - a[1])[0];

    elements.severityInsight.textContent = `${dominant[0]} is the largest segment for ${getModeScopeLabel(mode)}.`;
  }
}

function renderKpis() {
  const counts = getModeSeverityCounts(state.mode);
  const card1 = elements.kpiCritical.parentElement;
  const card2 = elements.kpiElevated.parentElement;
  const card3 = elements.kpiMonitor.parentElement;

  if (state.mode === 'Briefings') {
    card1.className = 'kpi-card unbriefed';
    card1.querySelector('.kpi-label').textContent = 'Unbriefed';
    elements.kpiCritical.textContent = counts.unbriefed;
    card1.querySelector('.kpi-sub').textContent = 'Not yet prepared';

    card2.className = 'kpi-card briefed';
    card2.querySelector('.kpi-label').textContent = 'Briefed';
    elements.kpiElevated.textContent = counts.briefed;
    card2.querySelector('.kpi-sub').textContent = 'Ready to go';

    card3.classList.add('d-none');
  } else {
    card1.className = 'kpi-card critical';
    card1.querySelector('.kpi-label').textContent = 'Critical';
    elements.kpiCritical.textContent = counts.critical;
    card1.querySelector('.kpi-sub').textContent = 'Needs action < 24h';

    card2.className = 'kpi-card elevated';
    card2.querySelector('.kpi-label').textContent = 'Elevated';
    elements.kpiElevated.textContent = counts.elevated;
    card2.querySelector('.kpi-sub').textContent = 'This week';

    card3.className = 'kpi-card observe';
    card3.querySelector('.kpi-label').textContent = 'Observe';
    elements.kpiMonitor.textContent = counts.observe;
    card3.querySelector('.kpi-sub').textContent = 'Watchlist';
    card3.classList.remove('d-none');
  }

  if (elements.kpiScopeLabel) {
    elements.kpiScopeLabel.textContent = getModeScopeLabel(state.mode);
  }

  renderSeverityCharts(counts, state.mode);
}
