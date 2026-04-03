// ── Tracking rendering — cards, rows, schedule controls, UI state ────

function autoResizeTextarea(textarea) {
  if (!textarea) return;
  textarea.style.setProperty('--auto-height', 'auto');
  textarea.style.setProperty('--auto-height', textarea.scrollHeight + 'px');
}

function buildSignalFilterHtml(item) {
  const activeSignals = Array.isArray(item.monitorSignals) ? item.monitorSignals : [...ALL_SIGNAL_TYPES];
  return `
    <div class="signal-filter" data-signal-filter-id="${escapeHtml(item.id)}">
      <span class="signal-filter-label">Signals:</span>
      ${SIGNAL_TYPE_OPTIONS.map((opt) => `
        <label class="signal-checkbox ${activeSignals.includes(opt.value) ? 'active' : ''}">
          <input type="checkbox" data-signal-type="${escapeHtml(opt.value)}" data-signal-item-id="${escapeHtml(item.id)}" ${activeSignals.includes(opt.value) ? 'checked' : ''} />
          <span class="signal-icon">${opt.icon}</span>
          <span class="signal-label">${escapeHtml(opt.label)}</span>
        </label>
      `).join('')}
    </div>`;
}

function buildWorkHoursToggleHtml(item) {
  const isInterval = item?.scheduleType !== 'one-time' && item?.scheduleType !== 'weekly';
  const tooltip = 'When enabled, interval checks only run between 8:00 AM and 5:00 PM local time.';
  return `<label class="${isInterval ? '' : 'd-none'}" data-work-hours-wrapper-id="${escapeHtml(item.id)}" title="${escapeHtml(tooltip)}"><input type="checkbox" data-work-hours-only-id="${escapeHtml(item.id)}" title="${escapeHtml(tooltip)}" ${item.workHoursOnly === true ? 'checked' : ''} /> Work Hours</label>`;
}

function parseWeeklyTimesInput(raw) {
  if (!raw) return [];
  return raw.split(/[,;]+/)
    .map((t) => t.trim().toLowerCase())
    .filter(Boolean)
    .map((t) => {
      const ampmMatch = t.match(/^(\d{1,2}):(\d{2})\s*(am|pm)$/i);
      if (ampmMatch) {
        let h = parseInt(ampmMatch[1], 10);
        const m = ampmMatch[2];
        const period = ampmMatch[3].toLowerCase();
        if (period === 'am' && h === 12) h = 0;
        if (period === 'pm' && h !== 12) h += 12;
        return `${String(h).padStart(2, '0')}:${m}`;
      }
      const plainMatch = t.match(/^(\d{1,2}):(\d{2})$/);
      if (plainMatch) {
        return `${plainMatch[1].padStart(2, '0')}:${plainMatch[2]}`;
      }
      return null;
    })
    .filter(Boolean);
}

function formatTime12h(time24) {
  const [hStr, m] = time24.split(':');
  let h = parseInt(hStr, 10);
  const suffix = h >= 12 ? 'PM' : 'AM';
  if (h === 0) h = 12;
  else if (h > 12) h -= 12;
  return `${h}:${m} ${suffix}`;
}

function formatWeeklyTimes(times) {
  if (!Array.isArray(times) || !times.length) return '';
  return times.map(formatTime12h).join(', ');
}

function buildWeeklyTimeSlotsHtml(times, idPrefix) {
  return times.map((t, i) => `
    <div class="weekly-time-slot">
      <input type="time" class="tracking-input weekly-time-picker" data-weekly-time-id="${escapeHtml(idPrefix)}" data-time-index="${i}" value="${escapeHtml(t)}" />
      ${times.length > 1 ? `<button type="button" class="weekly-time-remove" data-remove-time-id="${escapeHtml(idPrefix)}" data-time-index="${i}" title="Remove">&times;</button>` : ''}
    </div>
  `).join('');
}

function buildWeeklyScheduleHtml(item, idPrefix) {
  const days = Array.isArray(item.weeklyDays) ? item.weeklyDays : DEFAULT_WEEKLY_DAYS;
  const times = Array.isArray(item.weeklyTimes) ? item.weeklyTimes : DEFAULT_WEEKLY_TIMES;
  const hidden = item.scheduleType !== 'weekly' ? 'class="d-none"' : '';
  return `
    <div class="weekly-schedule-panel" data-weekly-panel-id="${escapeHtml(idPrefix)}" ${hidden}>
      <div class="weekly-days-row">
        ${WEEKLY_DAY_OPTIONS.map((d) => `
          <label class="weekly-day-label ${days.includes(d.value) ? 'active' : ''}">
            <input type="checkbox" class="weekly-day-cb" data-weekly-day-id="${escapeHtml(idPrefix)}" value="${escapeHtml(d.value)}" ${days.includes(d.value) ? 'checked' : ''} />
            ${escapeHtml(d.label)}
          </label>
        `).join('')}
      </div>
      <div class="weekly-times-row">
        <label class="add-task-label">Times</label>
        <div class="weekly-time-slots" data-time-slots-id="${escapeHtml(idPrefix)}">
          ${buildWeeklyTimeSlotsHtml(times, idPrefix)}
        </div>
        <button type="button" class="small-btn weekly-time-add" data-add-time-id="${escapeHtml(idPrefix)}">+ Add</button>
      </div>
    </div>`;
}

/**
 * Collect current time values from a time-slots container, update the item,
 * and re-render the slots in-place.
 */
function collectAndUpdateWeeklyTimes(container, itemId) {
  const slotsContainer = container.querySelector(`[data-time-slots-id="${CSS.escape(itemId)}"]`);
  if (!slotsContainer) return;
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (!item) return;
  const times = [...slotsContainer.querySelectorAll('.weekly-time-picker')].map((inp) => inp.value).filter(Boolean);
  if (!times.length) return;
  updateTrackingSchedule(itemId, 'weekly', item.scheduleValue, item.oneTimeAt, { weeklyTimes: times, skipRender: true });
  // Re-render slots in-place
  slotsContainer.innerHTML = buildWeeklyTimeSlotsHtml(item.weeklyTimes, itemId);
  inlineUpdateScheduleControls(container, itemId, 'weekly');
}

function buildScheduleControlsHtml(item) {
  const isInterval = item.scheduleType !== 'one-time' && item.scheduleType !== 'weekly';
  const isOneTime = item.scheduleType === 'one-time';
  const isWeekly = item.scheduleType === 'weekly';
  return `
    <select class="tracking-select" data-monitor-type-id="${escapeHtml(item.id)}">
      <option value="interval" ${isInterval ? 'selected' : ''}>Interval</option>
      <option value="weekly" ${isWeekly ? 'selected' : ''}>Scheduled</option>
      <option value="one-time" ${isOneTime ? 'selected' : ''}>One-time</option>
    </select>
    <select class="tracking-select${!isInterval ? ' d-none' : ''}" data-monitor-interval-id="${escapeHtml(item.id)}">
      ${SCHEDULE_INTERVAL_OPTIONS.map((option) => `<option value="${escapeHtml(option.value)}" ${item.scheduleValue === option.value ? 'selected' : ''}>Every ${escapeHtml(option.label)}</option>`).join('')}
    </select>
    <input class="tracking-input${isOneTime ? '' : ' d-none'}" type="datetime-local" data-monitor-onetime-id="${escapeHtml(item.id)}" value="${item.oneTimeAt ? escapeHtml(item.oneTimeAt.slice(0, 16)) : ''}" />
    ${buildWeeklyScheduleHtml(item, item.id)}`;
}
function severityColor(sev) {
  const s = (sev || '').toLowerCase();
  if (s === 'critical') return 'var(--color-critical)';
  if (s === 'elevated') return 'var(--color-elevated)';
  return 'var(--color-observe)';
}

function severityColorClass(sev) {
  const s = (sev || '').toLowerCase();
  if (s === 'critical') return 'at-event--critical';
  if (s === 'elevated') return 'at-event--elevated';
  return 'at-event--observe';
}

function applyTimelineDelays(container) {
  if (!container || typeof container.querySelectorAll !== 'function') return;
  const events = container.querySelectorAll('.at-event[data-at-index]');
  for (const el of events) {
    const idx = parseInt(el.getAttribute('data-at-index'), 10);
    if (Number.isFinite(idx)) {
      el.style.setProperty('--at-delay', (idx * 30) + 'ms');
    }
  }
}

function severityLabel(sev) {
  const s = (sev || '').toLowerCase();
  if (s === 'critical') return 'Critical';
  if (s === 'elevated') return 'Elevated';
  return 'Observe';
}

function timelineRelativeLabel(isoStr) {
  if (!isoStr) return '';
  const d = new Date(isoStr);
  if (!Number.isFinite(d.getTime())) return '';
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
    + ', ' + d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
}

function buildActivityTimelineHtml(updateHistory, options = {}) {
  const { maxVisible, itemId, item } = options;
  const entries = Array.isArray(updateHistory) ? updateHistory.slice() : [];

  if (!entries.length) return '';

  function renderEvent(e, i) {
    const label = severityLabel(e.severity);
    const timeLabel = timelineRelativeLabel(e.timestamp);
    const changeSummary = Array.isArray(e.changes) ? e.changes.join(' · ') : '';
    const isNewest = i === 0;
    const isLast = i === entries.length - 1;
    const isTerminal = item && (item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived');
    const isUnseen = !isTerminal && e.seen === false;

    const prevSeverity = i > 0 ? (entries[i - 1].severity || '').toLowerCase() : null;
    const curSeverity = (e.severity || '').toLowerCase();
    const sevChanged = prevSeverity && prevSeverity !== curSeverity;
    const escalated = sevChanged && (curSeverity === 'critical' || (curSeverity === 'elevated' && prevSeverity === 'observe'));

    const linkChips = Array.isArray(e.newLinks) && e.newLinks.length
      ? `<span class="at-links">${e.newLinks.map((l) => `<a class="at-link-chip" href="${escapeHtml(l.url)}" target="_blank" rel="noreferrer">${escapeHtml(l.label || 'link')}</a>`).join('')}</span>`
      : '';

    const summaryText = e.summary || '';
    const showSummary = summaryText && summaryText !== changeSummary;
    const summaryHtml = showSummary ? `<p class="at-summary">${escapeHtml(summaryText)}</p>` : '';

    const colorClass = severityColorClass(e.severity);
    return `<div class="at-event ${colorClass}${isNewest ? ' at-event--newest' : ''}${isUnseen ? ' at-event--unseen' : ''}" data-at-index="${i}">
      <div class="at-track">
        <div class="at-node">
          ${isNewest ? '<div class="at-node-ring"></div>' : ''}
          <div class="at-node-dot"></div>
        </div>
        ${!isLast ? `<div class="at-spine-segment${sevChanged ? ' at-spine-transition' : ''}"></div>` : ''}
      </div>
      <div class="at-card">
        <div class="at-card-head">
          <span class="at-time">${escapeHtml(timeLabel)}</span>
          ${!isNewest ? `<span class="at-severity pill severity-${escapeHtml(curSeverity)}">${escapeHtml(label)}</span>` : ''}
          ${sevChanged ? `<span class="at-transition-badge">${escalated ? '▲' : '▼'}</span>` : ''}
        </div>
        <p class="at-changes">${escapeHtml(changeSummary || 'No changes recorded')}</p>
        ${summaryHtml}
        ${linkChips}
      </div>
    </div>`;
  }

  const allEventsHtml = entries.map((e, i) => renderEvent(e, i));

  if (maxVisible && maxVisible < entries.length) {
    const visible = allEventsHtml.slice(0, maxVisible).join('');
    const hidden = allEventsHtml.slice(maxVisible).join('');
    const hiddenCount = entries.length - maxVisible;
    return `<div class="activity-timeline">${visible}<button class="at-show-older" data-at-show-older>Show ${hiddenCount} older</button><div class="at-hidden-events d-none">${hidden}</div></div>`;
  }

  return `<div class="activity-timeline">${allEventsHtml.join('')}</div>`;
}
function buildNextStepHintsHtml(item, alwaysShow = false) {
  const steps = Array.isArray(item?.suggestedNextSteps) ? item.suggestedNextSteps : [];
  if (!steps.length) return '';
  return `<div class="next-step-hints">${steps.map((s) => `<button class="next-step-hint" data-draft-suggestion="${escapeHtml(s)}" data-draft-item-id="${escapeHtml(item.id)}">\u2192 ${escapeHtml(s)} <span class="draft-cta">Draft \u2197</span></button>`).join('')}</div>`;
}

function buildHistorySuggestionsHtml(entry) {
  const steps = Array.isArray(entry?.suggestedNextSteps) ? entry.suggestedNextSteps : [];
  if (!steps.length) return '';
  return `<p class="history-suggestions">Suggested: ${steps.map(escapeHtml).join(' \u00B7 ')}</p>`;
}

function buildTrackerHistoryMarkup(item, emptyText = 'No history yet — updates appear here after meaningful changes.') {
  const historyEntries = Array.isArray(item.updateHistory) ? item.updateHistory : [];
  if (!historyEntries.length) {
    return `<div class="empty text-sm">${escapeHtml(emptyText)}</div>`;
  }
  return historyEntries.map((entry) => {
    const linksHtml = Array.isArray(entry.newLinks) && entry.newLinks.length
      ? `<ul class="source-list source-list--inline">${entry.newLinks.map((e) => {
          const recency = signalRecencyLabel(e.signalAt);
          return `<li><a href="${escapeHtml(e.url)}" target="_blank" rel="noreferrer">${escapeHtml(e.label || 'source')}</a>${recency ? ` <span class="source-recency">(${escapeHtml(recency)})</span>` : ''}</li>`;
        }).join('')}</ul>`
      : '';
    const summarySame = (entry.summary || '') === (item.summary || '');
    return `
      <div class="tracker-history-entry${entry.seen === false ? ' unseen' : ''}">
        <span class="history-ts">${escapeHtml(safeDate(entry.timestamp, 'Unknown'))}</span>
        <span class="history-change">${escapeHtml(entry.changes.join(' \u00b7 '))}</span>
        ${summarySame ? '' : `<p class="history-summary">${renderMarkdownLinks(entry.summary || '')}</p>`}
        ${linksHtml}
        ${buildHistorySuggestionsHtml(entry)}
      </div>
    `;
  }).join('');
}

function updateCustomTaskScheduleInput() {
  const val = elements.customTaskScheduleType?.value;
  const showOneTime = val === 'one-time';
  const showWeekly = val === 'weekly';
  const showInterval = !showOneTime && !showWeekly;
  if (elements.customTaskScheduleValue) {
    elements.customTaskScheduleValue.classList.toggle('d-none', !showInterval);
  }
  if (elements.customTaskOneTimeAt) {
    elements.customTaskOneTimeAt.classList.toggle('d-none', !showOneTime);
  }
  const weeklyPanel = document.getElementById('customTaskWeeklyPanel');
  if (weeklyPanel) {
    weeklyPanel.classList.toggle('d-none', !showWeekly);
  }
}

/**
 * Create a tracking item from explicit parameters (no DOM coupling).
 * Returns the created item, or null if validation failed.
 */
function createTrackingItemFromParams(params = {}) {
  const title = cleanDisplayText(params.title || '');
  if (!title) {
    showToast('Enter a task title before adding.', { icon: '\u26A0' });
    return null;
  }

  const contextValue = normalizeMultilineText(params.context || '');
  const scheduleType = params.scheduleType === 'one-time' ? 'one-time' : params.scheduleType === 'weekly' ? 'weekly' : 'interval';
  const oneTimeAt = toIsoOrNull(params.oneTimeAt || '');
  if (scheduleType === 'one-time' && !oneTimeAt) {
    showToast('Select a one-time run date and time.', { icon: '\u26A0' });
    return null;
  }

  let weeklyDays = params.weeklyDays || [...DEFAULT_WEEKLY_DAYS];
  let weeklyTimes = params.weeklyTimes || [...DEFAULT_WEEKLY_TIMES];
  if (scheduleType === 'weekly') {
    if (!weeklyDays.length) {
      showToast('Select at least one day of the week.', { icon: '\u26A0' });
      return null;
    }
    if (!weeklyTimes.length) {
      showToast('Add at least one time slot.', { icon: '\u26A0' });
      return null;
    }
  }

  const selectedSeverity = params.severity || 'Observe';
  const notifyEnabled = params.notifyEnabled !== false;
  const selectedSignals = Array.isArray(params.signals) && params.signals.length ? params.signals : [...ALL_SIGNAL_TYPES];

  const trackingItem = normalizeTrackingItem({
    id: `custom_${hashString(`${Date.now()}_${Math.random()}`)}`,
    title,
    severity: selectedSeverity,
    notifyEnabled,
    sourceType: 'Custom',
    dueAt: null,
    owner: 'You',
    counterparties: [],
    summary: contextValue || 'Monitoring started.',
    reason: 'Custom monitored task',
    status: 'Monitoring',
    trackedAt: nowIso(),
    origin: 'custom',
    monitorPrompt: contextValue || title,
    monitorSignals: selectedSignals,
    scheduleType,
    scheduleValue: params.scheduleValue || '30m',
    oneTimeAt,
    weeklyDays,
    weeklyTimes,
    monitorEnabled: true,
    scannerId: params.scannerId || null,
  });

  trackingItem.nextRunAt = computeNextRunAt(trackingItem);

  trackingItem.updateHistory.unshift({
    timestamp: trackingItem.trackedAt || nowIso(),
    changes: ['Created'],
    summary: trackingItem.summary || trackingItem.title || 'Monitoring started.',
    status: trackingItem.status,
    severity: trackingItem.severity,
    seen: true,
  });

  state.trackingItems.unshift(trackingItem);
  savePersistentState();
  addHistory('selection', `Added custom monitored task: ${trackingItem.title}`, { itemId: trackingItem.id });

  return trackingItem;
}

/**
 * Post-creation UI feedback: highlight item, scroll into view, show toast.
 */
function highlightNewItem(itemId) {
  const newEl = elements.radarList.querySelector(`[data-tracker-id="${CSS.escape(itemId)}"]`);
  if (newEl) {
    newEl.classList.add('just-created');
    newEl.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    setTimeout(() => {
      newEl.classList.add('glow-fade');
      setTimeout(() => {
        newEl.classList.remove('just-created', 'glow-fade');
      }, 1300);
    }, 1500);
  }
}

function createCustomTrackingItem() {
  const signalContainer = document.getElementById('customTaskSignals');
  const selectedSignals = signalContainer
    ? [...signalContainer.querySelectorAll('input[type="checkbox"]:checked')].map((cb) => cb.value).filter(Boolean)
    : [...ALL_SIGNAL_TYPES];

  let weeklyDays, weeklyTimes;
  const scheduleTypeRaw = elements.customTaskScheduleType?.value;
  if (scheduleTypeRaw === 'weekly') {
    const weeklyPanel = document.getElementById('customTaskWeeklyPanel');
    if (weeklyPanel) {
      weeklyDays = [...weeklyPanel.querySelectorAll('.weekly-day-cb:checked')].map((cb) => cb.value).filter(Boolean);
      weeklyTimes = [...weeklyPanel.querySelectorAll('.weekly-time-picker')].map((inp) => inp.value).filter(Boolean);
    }
  }

  const trackingItem = createTrackingItemFromParams({
    title: elements.customTaskTitle?.value || '',
    context: elements.customTaskContext?.value || '',
    scheduleType: scheduleTypeRaw,
    oneTimeAt: elements.customTaskOneTimeAt?.value || '',
    weeklyDays,
    weeklyTimes,
    severity: elements.customTaskSeverity?.value || 'Observe',
    notifyEnabled: elements.customTaskNotify?.checked !== false,
    signals: selectedSignals,
    scheduleValue: elements.customTaskScheduleValue?.value || '30m',
  });

  if (!trackingItem) return;

  if (elements.customTaskTitle) elements.customTaskTitle.value = '';
  if (elements.customTaskContext) elements.customTaskContext.value = '';
  if (elements.customTaskSeverity) elements.customTaskSeverity.value = 'Observe';
  if (elements.customTaskOneTimeAt) elements.customTaskOneTimeAt.value = '';
  if (elements.customTaskNotify) elements.customTaskNotify.checked = true;

  renderTrackingMode();
  highlightNewItem(trackingItem.id);
  showToast(`Task created: ${trackingItem.title}`, { icon: '\u2713' });
}

/**
 * Perform an inline DOM update of schedule controls visibility for a given item,
 * so we don't need a full re-render when the schedule type changes.
 */
function inlineUpdateScheduleControls(container, itemId, scheduleType) {
  if (!container) return;
  const isInterval = scheduleType !== 'one-time' && scheduleType !== 'weekly';
  const isOneTime = scheduleType === 'one-time';
  const isWeekly = scheduleType === 'weekly';

  const intervalSel = container.querySelector(`[data-monitor-interval-id="${CSS.escape(itemId)}"]`);
  const oneTimeIn = container.querySelector(`[data-monitor-onetime-id="${CSS.escape(itemId)}"]`);
  const weeklyPanel = container.querySelector(`[data-weekly-panel-id="${CSS.escape(itemId)}"]`);
  const workHoursToggle = container.querySelector(`[data-work-hours-wrapper-id="${CSS.escape(itemId)}"]`);

  if (intervalSel) intervalSel.classList.toggle('d-none', !isInterval);
  if (oneTimeIn) oneTimeIn.classList.toggle('d-none', !isOneTime);
  if (weeklyPanel) weeklyPanel.classList.toggle('d-none', !isWeekly);
  if (workHoursToggle) workHoursToggle.classList.toggle('d-none', !isInterval);

  // Update next-run text scoped to the right card
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (item) {
    const card = container.querySelector(`[data-tracker-id="${CSS.escape(itemId)}"]`);
    const nextRunEl = card?.querySelector('.task-next-run');
    if (nextRunEl) {
      nextRunEl.textContent = `Next run: ${safeDate(item.nextRunAt, 'Not scheduled')}`;
    }
  }
}

function popOutTrackerCard(item) {
  window.workiq.openTrackerPopout(item.id);
}

// ── Tracking UI state helpers ────────────────────────────────────────
const SECTION_PANEL_ATTRS = ['people', 'links', 'monitoring', 'history'];
const PROMPT_PANEL_ATTR = 'prompt';

function captureTrackingUiState() {
  const container = elements.trackingList;
  const expandedRowId = container.querySelector('.tracker-row-detail.show')?.parentElement?.getAttribute('data-tracker-id') || null;

  const sectionStates = {};
  for (const attr of SECTION_PANEL_ATTRS) {
    container.querySelectorAll(`[data-${attr}-panel-id]`).forEach((panel) => {
      const id = panel.getAttribute(`data-${attr}-panel-id`);
      if (!id) return;
      if (!sectionStates[id]) sectionStates[id] = {};
      sectionStates[id][attr] = panel.classList.contains('show');
    });
  }
  container.querySelectorAll('[data-prompt-panel-id]').forEach((panel) => {
    const id = panel.getAttribute('data-prompt-panel-id');
    if (!id) return;
    if (!sectionStates[id]) sectionStates[id] = {};
    sectionStates[id][PROMPT_PANEL_ATTR] = panel.classList.contains('show');
  });

  const scrollTop = container.scrollTop;

  return { expandedRowId, sectionStates, scrollTop };
}

function restoreTrackingUiState(saved) {
  const container = elements.trackingList;
  if (!saved) return;

  if (saved.expandedRowId) {
    const wrapper = container.querySelector(`[data-tracker-id="${CSS.escape(saved.expandedRowId)}"]`);
    if (wrapper) {
      const row = wrapper.querySelector('.tracker-row');
      const detail = wrapper.querySelector('.tracker-row-detail');
      if (row) row.classList.add('expanded');
      if (detail) detail.classList.add('show');
    }
  }

  for (const [itemId, sections] of Object.entries(saved.sectionStates)) {
    for (const attr of SECTION_PANEL_ATTRS) {
      if (sections[attr] === undefined) continue;
      const panel = container.querySelector(`[data-${attr}-panel-id="${CSS.escape(itemId)}"]`);
      const toggle = container.querySelector(`[data-${attr}-toggle-id="${CSS.escape(itemId)}"]`);
      if (panel) {
        panel.classList.toggle('show', sections[attr]);
        if (toggle) {
          toggle.classList.toggle('expanded', sections[attr]);
          const chevron = toggle.querySelector('.chevron');
          if (chevron) chevron.classList.toggle('chevron--expanded', sections[attr]);
        }
      }
    }
    if (sections[PROMPT_PANEL_ATTR] !== undefined) {
      const panel = container.querySelector(`[data-prompt-panel-id="${CSS.escape(itemId)}"]`);
      const toggle = container.querySelector(`[data-prompt-toggle-id="${CSS.escape(itemId)}"]`);
      if (panel) {
        panel.classList.toggle('show', sections[PROMPT_PANEL_ATTR]);
        if (toggle) {
          toggle.classList.toggle('expanded', sections[PROMPT_PANEL_ATTR]);
          const chevron = toggle.querySelector('.chevron');
          if (chevron) chevron.classList.toggle('chevron--expanded', sections[PROMPT_PANEL_ATTR]);
        }
      }
    }
  }

  if (saved.scrollTop) {
    container.scrollTop = saved.scrollTop;
  }
}

function buildCardTabsHtml(item) {
  const historyEntries = Array.isArray(item.updateHistory) ? item.updateHistory : [];
  const isTerminalStatus = item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived';
  const unseenCount = isTerminalStatus ? 0 : unseenHistoryCount(item);
  const hasNew = !isTerminalStatus && (item.hasNewUpdate === true || item.isNew === true);
  const people = Array.isArray(item.counterparties) && item.counterparties.length
    ? item.counterparties.join(', ')
    : 'No counterparties listed';

  const historyCount = historyEntries.length;
  let historyBadgeClass = '';
  if (unseenCount >= 6) historyBadgeClass = 'history-badge--critical';
  else if (unseenCount >= 3) historyBadgeClass = 'history-badge--elevated';
  else if (unseenCount >= 1) historyBadgeClass = 'history-badge--observe';

  const linksHtml = (() => {
    const links = Array.isArray(item.evidenceLinks) ? item.evidenceLinks.filter((e) => e && e.url) : [];
    if (!links.length) return '<div class="empty text-sm">No links yet.</div>';
    return `<ul class="source-list">${links.map((e) => {
      const recency = signalRecencyLabel(e.signalAt);
      return `<li><a href="${escapeHtml(e.url)}" target="_blank" rel="noreferrer">${escapeHtml(e.label || 'source')}</a>${recency ? ` <span class="source-recency">(${escapeHtml(recency)})</span>` : ''}</li>`;
    }).join('')}</ul>`;
  })();

  return `
    <div class="card-tabs" data-card-tabs-id="${escapeHtml(item.id)}">
      <div class="card-tab-bar">
        <button class="card-tab active" title="Activity Timeline" data-card-tab="summary" data-card-tab-item-id="${escapeHtml(item.id)}"><span class="card-tab-icon">⏱️</span><span class="card-tab-label">Activity</span>${unseenCount > 0 ? `<span class="card-tab-badge ${historyBadgeClass}">${unseenCount}</span>` : ''}</button>
        <button class="card-tab" title="Overview" data-card-tab="overview" data-card-tab-item-id="${escapeHtml(item.id)}"><span class="card-tab-icon">\uD83D\uDCCB</span><span class="card-tab-label">Overview</span></button>
        <button class="card-tab" title="Monitoring" data-card-tab="monitor" data-card-tab-item-id="${escapeHtml(item.id)}"><span class="card-tab-icon">\u2699\uFE0F</span><span class="card-tab-label">Monitor</span></button>
      </div>
      <div class="card-tab-panel active" data-card-tab-panel="summary" data-card-tab-panel-item-id="${escapeHtml(item.id)}">
        ${(() => { const lastUpdate = item.lastChangedAt || item.lastRunAt || null; const ts = lastUpdate ? new Date(lastUpdate) : null; const timeStr = ts && Number.isFinite(ts.getTime()) ? ts.toLocaleString() : null; const rt = relativeTime(lastUpdate); return hasNew && timeStr ? `<div class="tracker-updated-at">Updated: ${escapeHtml(timeStr)} (${escapeHtml(rt)})</div>` : ''; })()}
        ${buildActivityTimelineHtml(item.updateHistory, { maxVisible: 3, itemId: item.id, item })}
      </div>
      <div class="card-tab-panel" data-card-tab-panel="overview" data-card-tab-panel-item-id="${escapeHtml(item.id)}">
        ${buildNextStepHintsHtml(item)}
        <div class="tracker-meta">
          <span>Source: ${escapeHtml(item.sourceType || 'Signal')}</span>
          <span>Due: <span class="editable-field" data-edit-field="dueAt" data-item-id="${escapeHtml(item.id)}" title="Click to edit">${item.dueAt ? escapeHtml(safeDate(item.dueAt)) : '<span class="field-placeholder">Set due date</span>'}</span></span>
          <span>Owner: <span class="editable-field" data-edit-field="owner" data-item-id="${escapeHtml(item.id)}" title="Click to edit">${item.owner ? escapeHtml(item.owner) : '<span class="field-placeholder">Set owner</span>'}</span></span>
        </div>
        <div class="tracker-timestamp">
          Tracked: ${escapeHtml(safeDate(item.trackedAt, 'Unknown'))} \u00b7 Last checked: ${escapeHtml(safeDate(item.lastRunAt, 'Never'))}
        </div>
        <div class="card-tab-section">
          <h4 class="card-tab-section-title">People (${Array.isArray(item.counterparties) ? item.counterparties.length : 0})</h4>
          <p class="people-text">${escapeHtml(people)}</p>
        </div>
        <div class="card-tab-section">
          <h4 class="card-tab-section-title">Links</h4>
          ${linksHtml}
        </div>
      </div>
      <div class="card-tab-panel" data-card-tab-panel="monitor" data-card-tab-panel-item-id="${escapeHtml(item.id)}">
        <div class="monitor-source-section">
          <label class="monitor-source-label">Source</label>
          <select class="monitor-source-select" data-move-to-scanner-id="${escapeHtml(item.id)}">
            ${(state.scanners || []).map(s => {
              const effectiveId = item.scannerId || '';
              return `<option value="${escapeHtml(s.id)}"${effectiveId === s.id ? ' selected' : ''}>${escapeHtml(s.name)}</option>`;
            }).join('')}
          </select>
        </div>
        <div class="tracker-schedule-bar">
          <div class="tracking-inline">
            <label><input type="checkbox" data-monitor-enabled-id="${escapeHtml(item.id)}" ${item.monitorEnabled !== false ? 'checked' : ''} /> Enabled</label>
            <label><input type="checkbox" data-notify-enabled-id="${escapeHtml(item.id)}" ${item.notifyEnabled !== false ? 'checked' : ''} /> Notifications</label>
            ${buildWorkHoursToggleHtml(item)}
            ${buildScheduleControlsHtml(item)}
            <button class="small-btn" data-monitor-run-now-id="${escapeHtml(item.id)}">Run check now</button>
          </div>
          ${buildSignalFilterHtml(item)}
          <p class="task-next-run">Next run: ${escapeHtml(safeDate(item.nextRunAt, 'Not scheduled'))}</p>
          <button class="tracker-prompt-toggle" data-prompt-toggle-id="${escapeHtml(item.id)}">
            <span class="chevron">&#9654;</span> Edit monitoring prompt
          </button>
          <div class="tracker-prompt-panel" data-prompt-panel-id="${escapeHtml(item.id)}">
            <textarea class="tracking-textarea" data-monitor-prompt-id="${escapeHtml(item.id)}" placeholder="Monitoring context for WorkIQ">${escapeHtml(item.monitorPrompt || '')}</textarea>
          </div>
          <div class="monitor-danger-zone">
            <button class="small-btn warn" data-dismiss-radar-id="${escapeHtml(item.id)}">Delete this item</button>
          </div>
        </div>
      </div>
    </div>`;
}

function buildTrackingCard(item) {
  const isTerminalStatus = item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived';
  const hasNew = !isTerminalStatus && (item.hasNewUpdate === true || item.isNew === true);
  const unseenCount = isTerminalStatus ? 0 : unseenHistoryCount(item);

  return `
    <article class="tracker-card ${hasNew ? 'has-new-update is-new' : ''} ${item.lifecycleStatus === 'snoozed' ? 'snoozed-card' : ''}" data-tracker-id="${escapeHtml(item.id)}" data-item-severity="${escapeHtml(item.severity || 'Observe')}" data-item-status="${escapeHtml(item.lifecycleStatus || 'in-progress')}" data-item-new="${hasNew ? 'true' : 'false'}">
      <div class="tracker-head">
        <div class="tracker-head-left">
          <select class="severity-select ${severityClass(item.severity)}" data-severity-select-id="${escapeHtml(item.id)}">
            <option value="Critical" ${item.severity === 'Critical' ? 'selected' : ''}>Critical</option>
            <option value="Elevated" ${item.severity === 'Elevated' ? 'selected' : ''}>Elevated</option>
            <option value="Observe" ${item.severity === 'Observe' ? 'selected' : ''}>Observe</option>
          </select>
          <select class="status-select status-${item.lifecycleStatus || 'in-progress'}" data-status-select-id="${escapeHtml(item.id)}">
            ${LIFECYCLE_STATUSES.map(s => `<option value="${escapeHtml(s)}" ${item.lifecycleStatus === s ? 'selected' : ''}>${escapeHtml(LIFECYCLE_LABELS[s])}</option>`).join('')}
          </select>
          ${item.lifecycleStatus === 'snoozed' ? `<span class="snooze-until-label" title="Snoozed until ${item.snoozeUntil ? escapeHtml(safeDate(item.snoozeUntil)) : 'next scan'}">💤 ${item.snoozeUntil ? escapeHtml(relativeTime(item.snoozeUntil) || safeDate(item.snoozeUntil)) : 'next scan'}</span>` : ''}
        </div>
        <div class="tracker-head-right">
          ${item.monitorEnabled === false ? '<span class="pill paused-pill">Paused</span>' : ''}
          ${hasNew ? '<span class="tracker-new-badge">' + (unseenCount > 1 ? unseenCount + ' ' : '') + 'New</span>' : (() => { const lastUpdate = item.lastChangedAt || item.lastRunAt || null; const rt = relativeTime(lastUpdate); return rt ? '<span class="pill last-updated-pill" title="Last update: ' + escapeHtml(safeDate(lastUpdate)) + '">' + escapeHtml(rt) + '</span>' : ''; })()}
          ${(hasNew || unseenCount > 0) ? `<button class="icon-btn mark-seen-btn" data-mark-seen-id="${escapeHtml(item.id)}" title="Mark as seen">👁️</button>` : ''}
          <button class="popout-icon-btn" data-popout-id="${escapeHtml(item.id)}" title="Pop Out" aria-label="Pop out">\u2197</button>
        </div>
      </div>
      <div class="card-body">
        <div class="item-title-wrap">
          <h3 class="tracker-title">
            <span class="item-title-text editable-field" data-edit-field="title" data-item-id="${escapeHtml(item.id)}" title="Click to edit">${escapeHtml(item.title || 'Untitled item')}</span>
            <button class="edit-field-btn" data-edit-field="title" data-item-id="${escapeHtml(item.id)}" title="Edit title" aria-label="Edit title">\u270f\ufe0f</button>
          </h3>
        </div>
        ${buildNextStepHintsHtml(item)}
        ${buildCardTabsHtml(item)}
      </div>
    </article>
  `;
}

function buildTrackingRow(item, expandedRowId) {
  const isTerminalStatus = item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived';
  const hasNew = !isTerminalStatus && (item.hasNewUpdate === true || item.isNew === true);
  const unseenCount = isTerminalStatus ? 0 : unseenHistoryCount(item);
  const isExpanded = item.id === expandedRowId;
  const people = Array.isArray(item.counterparties) && item.counterparties.length
    ? item.counterparties.join(', ')
    : 'No counterparties listed';
  const historyEntries = Array.isArray(item.updateHistory) ? item.updateHistory : [];

  const linksBlock = (() => {
    const links = Array.isArray(item.evidenceLinks) ? item.evidenceLinks.filter((e) => e && e.url) : [];
    if (!links.length) return '';
    const linksHtml = links.map((e) => {
      const recency = signalRecencyLabel(e.signalAt);
      return `<li><a href="${escapeHtml(e.url)}" target="_blank" rel="noreferrer">${escapeHtml(e.label || 'source')}</a>${recency ? ` <span class="source-recency">(${escapeHtml(recency)})</span>` : ''}</li>`;
    }).join('');
    return `
      <button class="tracker-section-toggle expanded" data-links-toggle-id="${escapeHtml(item.id)}">
        <span class="chevron chevron--expanded">&#9654;</span> Links (${links.length})
      </button>
      <div class="tracker-section-panel show" data-links-panel-id="${escapeHtml(item.id)}">
        <ul class="source-list">${linksHtml}</ul>
      </div>`;
  })();

  return `
  <div class="tracker-row-wrapper ${hasNew ? 'is-new' : ''} ${item.lifecycleStatus === 'snoozed' ? 'snoozed-card' : ''}" data-tracker-id="${escapeHtml(item.id)}" data-item-severity="${escapeHtml(item.severity || 'Observe')}" data-item-status="${escapeHtml(item.lifecycleStatus || 'in-progress')}" data-item-new="${hasNew ? 'true' : 'false'}">
    <div class="tracker-row ${hasNew ? 'has-new-update' : ''} ${isExpanded ? 'expanded' : ''}" data-row-toggle-id="${escapeHtml(item.id)}">
      <select class="severity-select ${severityClass(item.severity)}" data-severity-select-id="${escapeHtml(item.id)}">
        <option value="Critical" ${item.severity === 'Critical' ? 'selected' : ''}>Critical</option>
        <option value="Elevated" ${item.severity === 'Elevated' ? 'selected' : ''}>Elevated</option>
        <option value="Observe" ${item.severity === 'Observe' ? 'selected' : ''}>Observe</option>
      </select>
      <select class="status-select status-${item.lifecycleStatus || 'in-progress'}" data-status-select-id="${escapeHtml(item.id)}">
        ${LIFECYCLE_STATUSES.map(s => `<option value="${escapeHtml(s)}" ${item.lifecycleStatus === s ? 'selected' : ''}>${escapeHtml(LIFECYCLE_LABELS[s])}</option>`).join('')}
      </select>
      ${item.lifecycleStatus === 'snoozed' ? `<span class="snooze-until-label" title="Snoozed until ${item.snoozeUntil ? escapeHtml(safeDate(item.snoozeUntil)) : 'next scan'}">💤 ${item.snoozeUntil ? escapeHtml(relativeTime(item.snoozeUntil) || safeDate(item.snoozeUntil)) : 'next scan'}</span>` : ''}
      ${item.monitorEnabled === false ? '<span class="pill paused-pill">Paused</span>' : ''}
      ${hasNew ? `<span class="pill badge-pill">${unseenCount > 1 ? unseenCount + ' ' : ''}New</span>` : ''}
      ${(() => { const lastUpdate = item.lastChangedAt || item.lastRunAt || null; const rt = relativeTime(lastUpdate); return rt ? `<span class="pill last-updated-pill ${hasNew ? 'popped' : ''}" title="Updated: ${escapeHtml(safeDate(lastUpdate))}">${escapeHtml(rt)}</span>` : ''; })()}
      <span class="tracker-row-title">
        <span class="editable-field" data-edit-field="title" data-item-id="${escapeHtml(item.id)}" title="Click to edit">${escapeHtml(item.title || 'Untitled item')}</span>
      </span>
      <span class="tracker-row-summary">${escapeHtml((item.summary || '').replace(/\n/g, ' ').slice(0, 140))}${(item.summary || '').length > 140 ? '\u2026' : ''}</span>
      <span class="tracker-row-due">
        <span class="editable-field" data-edit-field="dueAt" data-item-id="${escapeHtml(item.id)}" title="Click to edit">${item.dueAt ? escapeHtml(safeDate(item.dueAt)) : '<span class="field-placeholder">Set due</span>'}</span>
      </span>
      <span class="row-expand-chevron ${isExpanded ? 'open' : ''}">&#9660;</span>
    </div>
    <div class="tracker-row-detail ${isExpanded ? 'show' : ''}">
      ${(() => { const lastUpdate = item.lastChangedAt || item.lastRunAt || null; const ts = lastUpdate ? new Date(lastUpdate) : null; const timeStr = ts && Number.isFinite(ts.getTime()) ? ts.toLocaleString() : null; const rt = relativeTime(lastUpdate); return hasNew && timeStr ? '<div class="tracker-updated-at">Updated: ' + escapeHtml(timeStr) + ' (' + escapeHtml(rt) + ')</div>' : ''; })()}
      ${buildActivityTimelineHtml(item.updateHistory, { maxVisible: 3, itemId: item.id, item })}
      ${buildNextStepHintsHtml(item)}
      <div class="tracker-meta">
        <span>Source: ${escapeHtml(item.sourceType || 'Signal')}</span>
        <span>Due: <span class="editable-field" data-edit-field="dueAt" data-item-id="${escapeHtml(item.id)}" title="Click to edit">${item.dueAt ? escapeHtml(safeDate(item.dueAt)) : '<span class="field-placeholder">Set due date</span>'}</span></span>
        <span>Owner: <span class="editable-field" data-edit-field="owner" data-item-id="${escapeHtml(item.id)}" title="Click to edit">${item.owner ? escapeHtml(item.owner) : '<span class="field-placeholder">Set owner</span>'}</span></span>
      </div>
      <div class="tracker-timestamp">
        Tracked: ${escapeHtml(safeDate(item.trackedAt, 'Unknown'))} \u00b7 Last checked: ${escapeHtml(safeDate(item.lastRunAt, 'Never'))}
      </div>
      <button class="tracker-section-toggle expanded" data-people-toggle-id="${escapeHtml(item.id)}">
        <span class="chevron chevron--expanded">&#9654;</span> People (${(Array.isArray(item.counterparties) ? item.counterparties.length : 0)})
      </button>
      <div class="tracker-section-panel show" data-people-panel-id="${escapeHtml(item.id)}">
        <p class="people-text">${escapeHtml(people)}</p>
      </div>
      ${linksBlock}

      <button class="tracker-section-toggle" data-monitoring-toggle-id="${escapeHtml(item.id)}">
        <span class="chevron">&#9654;</span> Monitoring
      </button>
      <div class="tracker-section-panel" data-monitoring-panel-id="${escapeHtml(item.id)}">
        <div class="tracker-schedule-bar">
          <div class="tracking-inline">
            <label><input type="checkbox" data-monitor-enabled-id="${escapeHtml(item.id)}" ${item.monitorEnabled !== false ? 'checked' : ''} /> Enabled</label>
            <label><input type="checkbox" data-notify-enabled-id="${escapeHtml(item.id)}" ${item.notifyEnabled !== false ? 'checked' : ''} /> Notifications</label>
            ${buildWorkHoursToggleHtml(item)}
            ${buildScheduleControlsHtml(item)}
            <button class="small-btn" data-monitor-run-now-id="${escapeHtml(item.id)}">Run check now</button>
          </div>
          ${buildSignalFilterHtml(item)}
          <p class="task-next-run">Next run: ${escapeHtml(safeDate(item.nextRunAt, 'Not scheduled'))}</p>
          <button class="tracker-prompt-toggle" data-prompt-toggle-id="${escapeHtml(item.id)}">
            <span class="chevron">&#9654;</span> Edit monitoring prompt
          </button>
          <div class="tracker-prompt-panel" data-prompt-panel-id="${escapeHtml(item.id)}">
            <textarea class="tracking-textarea" data-monitor-prompt-id="${escapeHtml(item.id)}" placeholder="Monitoring context for WorkIQ">${escapeHtml(item.monitorPrompt || '')}</textarea>
          </div>
        </div>
      </div>

      <div class="action-row">
        ${(hasNew || unseenCount > 0) ? '<button class="small-btn primary" data-mark-seen-id="' + escapeHtml(item.id) + '">Mark as Seen</button>' : ''}
        <button class="small-btn popout" data-popout-id="${escapeHtml(item.id)}">&#x2197; Pop Out</button>
        <button class="small-btn warn" data-dismiss-radar-id="${escapeHtml(item.id)}">Delete</button>
      </div>
    </div>
  </div>
  `;
}

function renderTrackingMode() {
  renderRadarMode();
}

// --- Old renderTrackingMode body removed --- unified into renderRadarMode
/* eslint-disable */
void function _deadCode() {
// Sync density toggle icon state
  const densityBtn = document.getElementById('densityToggleBtn');
  if (densityBtn) {
    densityBtn.classList.toggle('is-minimal', state.trackingDensity === 'minimal');
    densityBtn.title = state.trackingDensity === 'minimal' ? 'Switch to card view' : 'Switch to list view';
  }

  const sortedItems = sortBySeverity(state.trackingItems, true);

  const isMinimal = state.trackingDensity === 'minimal';
  elements.trackingList.classList.toggle('list--minimal', isMinimal);

  // Capture current UI state before rebuilding the DOM
  const savedUiState = captureTrackingUiState();

  if (isMinimal) {
    elements.trackingList.innerHTML = sortedItems.map((item) => {
      const isTerminalStatus = item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived';
      const hasNew = !isTerminalStatus && (item.hasNewUpdate === true || item.isNew === true);
      const unseenCount = isTerminalStatus ? 0 : unseenHistoryCount(item);
      const isExpanded = item.id === savedUiState.expandedRowId;
      const people = Array.isArray(item.counterparties) && item.counterparties.length
        ? item.counterparties.join(', ')
        : 'No counterparties listed';
      const historyEntries = Array.isArray(item.updateHistory) ? item.updateHistory : [];

      const linksBlock = (() => {
        const links = Array.isArray(item.evidenceLinks) ? item.evidenceLinks.filter((e) => e && e.url) : [];
        if (!links.length) return '';
        const linksHtml = links.map((e) => {
          const recency = signalRecencyLabel(e.signalAt);
          return `<li><a href="${escapeHtml(e.url)}" target="_blank" rel="noreferrer">${escapeHtml(e.label || 'source')}</a>${recency ? ` <span class="source-recency">(${escapeHtml(recency)})</span>` : ''}</li>`;
        }).join('');
        return `
          <button class="tracker-section-toggle expanded" data-links-toggle-id="${escapeHtml(item.id)}">
            <span class="chevron chevron--expanded">&#9654;</span> Links (${links.length})
          </button>
          <div class="tracker-section-panel show" data-links-panel-id="${escapeHtml(item.id)}">
            <ul class="source-list">${linksHtml}</ul>
          </div>`;
      })();

      const historyMarkup = buildTrackerHistoryMarkup(item, 'No history yet.');

      return `
      <div class="tracker-row-wrapper ${hasNew ? 'is-new' : ''}" data-tracker-id="${escapeHtml(item.id)}">
        <div class="tracker-row ${hasNew ? 'has-new-update' : ''} ${isExpanded ? 'expanded' : ''}" data-row-toggle-id="${escapeHtml(item.id)}">
          <select class="severity-select ${severityClass(item.severity)}" data-severity-select-id="${escapeHtml(item.id)}">
            <option value="Critical" ${item.severity === 'Critical' ? 'selected' : ''}>Critical</option>
            <option value="Elevated" ${item.severity === 'Elevated' ? 'selected' : ''}>Elevated</option>
            <option value="Observe" ${item.severity === 'Observe' ? 'selected' : ''}>Observe</option>
          </select>
          ${item.monitorEnabled === false ? '<span class="pill paused-pill">Paused</span>' : ''}
          ${hasNew ? `<span class="pill badge-pill">${unseenCount > 1 ? unseenCount + ' ' : ''}New</span>` : ''}
          ${(() => { const lastUpdate = item.lastChangedAt || item.lastRunAt || null; const rt = relativeTime(lastUpdate); return rt ? `<span class="pill last-updated-pill ${hasNew ? 'popped' : ''}" title="Updated: ${escapeHtml(safeDate(lastUpdate))}">${escapeHtml(rt)}</span>` : ''; })()}
          <span class="tracker-row-title">
            <span class="editable-field" data-edit-field="title" data-item-id="${escapeHtml(item.id)}" title="Click to edit">${escapeHtml(item.title || 'Untitled item')}</span>
          </span>
          <span class="tracker-row-summary">${escapeHtml((item.summary || '').replace(/\n/g, ' ').slice(0, 140))}${(item.summary || '').length > 140 ? '…' : ''}</span>
          <span class="tracker-row-due">
            <span class="editable-field" data-edit-field="dueAt" data-item-id="${escapeHtml(item.id)}" title="Click to edit">${item.dueAt ? escapeHtml(safeDate(item.dueAt)) : '<span class="field-placeholder">Set due</span>'}</span>
          </span>
          <span class="row-expand-chevron ${isExpanded ? 'open' : ''}">&#9660;</span>
        </div>
        <div class="tracker-row-detail ${isExpanded ? 'show' : ''}">
          ${(() => { const lastUpdate = item.lastChangedAt || item.lastRunAt || null; const ts = lastUpdate ? new Date(lastUpdate) : null; const timeStr = ts && Number.isFinite(ts.getTime()) ? ts.toLocaleString() : null; const rt = relativeTime(lastUpdate); return hasNew && timeStr ? `<div class="tracker-updated-at">Updated: ${escapeHtml(timeStr)} (${escapeHtml(rt)})</div>` : ''; })()}
          <p class="tracker-summary">${renderMarkdownLinks(item.summary || 'No summary available.')}</p>
          ${buildNextStepHintsHtml(item)}
          <div class="tracker-meta">
            <span>Source: ${escapeHtml(item.sourceType || 'Signal')}</span>
            <span>Due: <span class="editable-field" data-edit-field="dueAt" data-item-id="${escapeHtml(item.id)}" title="Click to edit">${item.dueAt ? escapeHtml(safeDate(item.dueAt)) : '<span class="field-placeholder">Set due date</span>'}</span></span>
            <span>Owner: <span class="editable-field" data-edit-field="owner" data-item-id="${escapeHtml(item.id)}" title="Click to edit">${item.owner ? escapeHtml(item.owner) : '<span class="field-placeholder">Set owner</span>'}</span></span>
          </div>
          <div class="tracker-timestamp">
            Tracked: ${escapeHtml(safeDate(item.trackedAt, 'Unknown'))} · Last checked: ${escapeHtml(safeDate(item.lastRunAt, 'Never'))}
          </div>
          <button class="tracker-section-toggle expanded" data-people-toggle-id="${escapeHtml(item.id)}">
            <span class="chevron chevron--expanded">&#9654;</span> People (${(Array.isArray(item.counterparties) ? item.counterparties.length : 0)})
          </button>
          <div class="tracker-section-panel show" data-people-panel-id="${escapeHtml(item.id)}">
            <p class="people-text">${escapeHtml(people)}</p>
          </div>
          ${linksBlock}

          <button class="tracker-section-toggle" data-monitoring-toggle-id="${escapeHtml(item.id)}">
            <span class="chevron">&#9654;</span> Monitoring
          </button>
          <div class="tracker-section-panel" data-monitoring-panel-id="${escapeHtml(item.id)}">
            <div class="tracker-schedule-bar">
              <div class="tracking-inline">
                <label><input type="checkbox" data-monitor-enabled-id="${escapeHtml(item.id)}" ${item.monitorEnabled !== false ? 'checked' : ''} /> Enabled</label>
                <label><input type="checkbox" data-notify-enabled-id="${escapeHtml(item.id)}" ${item.notifyEnabled !== false ? 'checked' : ''} /> Notifications</label>
                ${buildWorkHoursToggleHtml(item)}
                ${buildScheduleControlsHtml(item)}
                <button class="small-btn" data-monitor-run-now-id="${escapeHtml(item.id)}">Run check now</button>
              </div>
              ${buildSignalFilterHtml(item)}
              <p class="task-next-run">Next run: ${escapeHtml(safeDate(item.nextRunAt, 'Not scheduled'))}</p>
              <button class="tracker-prompt-toggle" data-prompt-toggle-id="${escapeHtml(item.id)}">
                <span class="chevron">&#9654;</span> Edit monitoring prompt
              </button>
              <div class="tracker-prompt-panel" data-prompt-panel-id="${escapeHtml(item.id)}">
                <textarea class="tracking-textarea" data-monitor-prompt-id="${escapeHtml(item.id)}" placeholder="Monitoring context for WorkIQ">${escapeHtml(item.monitorPrompt || '')}</textarea>
              </div>
            </div>
          </div>


          <div class="action-row">
            ${(hasNew || unseenCount > 0) ? `<button class="small-btn primary" data-mark-seen-id="${escapeHtml(item.id)}">Mark as Seen</button>` : ''}
            <button class="small-btn popout" data-popout-id="${escapeHtml(item.id)}">&#x2197; Pop Out</button>
            <button class="small-btn warn" data-dismiss-radar-id="${escapeHtml(item.id)}">Delete</button>
          </div>
        </div>
      </div>
      `;
    }).join('');
    autoSizeSeveritySelects(elements.trackingList);
    restoreTrackingUiState(savedUiState);
    // Enforce schedule-control visibility via DOM API — inline style attributes
    // from the HTML template are not reliably applied after innerHTML replacement.
    sortedItems.forEach(item => {
      inlineUpdateScheduleControls(elements.trackingList, item.id, item.scheduleType);
    });
    renderKpis();
    return;
  }

  elements.trackingList.innerHTML = sortedItems.map((item) => {
    const historyEntries = Array.isArray(item.updateHistory) ? item.updateHistory : [];
    const isTerminalStatus = item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived';
    const hasNew = !isTerminalStatus && (item.hasNewUpdate === true || item.isNew === true);
    const people = Array.isArray(item.counterparties) && item.counterparties.length
      ? item.counterparties.join(', ')
      : 'No counterparties listed';

    const unseenCount = isTerminalStatus ? 0 : unseenHistoryCount(item);
    const historyMarkup = buildTrackerHistoryMarkup(item);

    return `
    <article class="tracker-card ${hasNew ? 'has-new-update' : ''} ${item.lifecycleStatus === 'snoozed' ? 'snoozed-card' : ''}" data-tracker-id="${escapeHtml(item.id)}">
      <div class="tracker-head">
        <div class="tracker-head-left">
          <select class="severity-select ${severityClass(item.severity)}" data-severity-select-id="${escapeHtml(item.id)}">
            <option value="Critical" ${item.severity === 'Critical' ? 'selected' : ''}>Critical</option>
            <option value="Elevated" ${item.severity === 'Elevated' ? 'selected' : ''}>Elevated</option>
            <option value="Observe" ${item.severity === 'Observe' ? 'selected' : ''}>Observe</option>
          </select>
          <select class="status-select status-${item.lifecycleStatus || 'in-progress'}" data-status-select-id="${escapeHtml(item.id)}">
            ${LIFECYCLE_STATUSES.map(s => `<option value="${escapeHtml(s)}" ${item.lifecycleStatus === s ? 'selected' : ''}>${escapeHtml(LIFECYCLE_LABELS[s])}</option>`).join('')}
          </select>
          ${item.lifecycleStatus === 'snoozed' ? `<span class="snooze-until-label" title="Snoozed until ${item.snoozeUntil ? escapeHtml(safeDate(item.snoozeUntil)) : 'next scan'}">💤 ${item.snoozeUntil ? escapeHtml(relativeTime(item.snoozeUntil) || safeDate(item.snoozeUntil)) : 'next scan'}</span>` : ''}
        </div>
        <div class="tracker-head-right">
          ${item.monitorEnabled === false ? '<span class="pill paused-pill">Paused</span>' : ''}
          ${(() => { if (hasNew) { const label = unseenCount > 1 ? `${unseenCount} NEW` : 'NEW'; const lastUpdate = item.lastChangedAt || item.lastRunAt || null; const ts = lastUpdate ? new Date(lastUpdate) : null; const timeStr = ts && Number.isFinite(ts.getTime()) ? ts.toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' }) : null; return `<span class="tracker-new-badge">${label}${timeStr ? ` \u00b7 ${timeStr}` : ''}</span>`; } const lastUpdate = item.lastChangedAt || item.lastRunAt || null; const rt = relativeTime(lastUpdate); return rt ? `<span class="pill last-updated-pill" title="Last update: ${escapeHtml(safeDate(lastUpdate))}">${escapeHtml(rt)}</span>` : ''; })()}
        </div>
      </div>
      <div class="card-body">
        ${(() => { const lastUpdate = item.lastChangedAt || item.lastRunAt || null; const ts = lastUpdate ? new Date(lastUpdate) : null; const timeStr = ts && Number.isFinite(ts.getTime()) ? ts.toLocaleString() : null; const rt = relativeTime(lastUpdate); return hasNew && timeStr ? `<div class="tracker-updated-at">Updated: ${escapeHtml(timeStr)} (${escapeHtml(rt)})</div>` : ''; })()}
        ${buildActivityTimelineHtml(item.updateHistory, { maxVisible: 3, itemId: item.id, item })}
        <div class="tracker-meta">
          <span>Source: ${escapeHtml(item.sourceType || 'Signal')}</span>
          <span>Due: <span class="editable-field" data-edit-field="dueAt" data-item-id="${escapeHtml(item.id)}" title="Click to edit">${item.dueAt ? escapeHtml(safeDate(item.dueAt)) : '<span class="field-placeholder">Set due date</span>'}</span></span>
          <span>Owner: <span class="editable-field" data-edit-field="owner" data-item-id="${escapeHtml(item.id)}" title="Click to edit">${item.owner ? escapeHtml(item.owner) : '<span class="field-placeholder">Set owner</span>'}</span></span>
        </div>
        <div class="tracker-timestamp">
          Tracked: ${escapeHtml(safeDate(item.trackedAt, 'Unknown'))} · Last checked: ${escapeHtml(safeDate(item.lastRunAt, 'Never'))}
        </div>
        <button class="tracker-section-toggle expanded" data-people-toggle-id="${escapeHtml(item.id)}">
          <span class="chevron chevron--expanded">&#9654;</span> People (${(Array.isArray(item.counterparties) ? item.counterparties.length : 0)})
        </button>
        <div class="tracker-section-panel show" data-people-panel-id="${escapeHtml(item.id)}">
          <p class="people-text">${escapeHtml(people)}</p>
        </div>
        ${(() => {
          const links = Array.isArray(item.evidenceLinks) ? item.evidenceLinks.filter((e) => e && e.url) : [];
          if (!links.length) return '';
          const linksHtml = links.map((e) => {
            const recency = signalRecencyLabel(e.signalAt);
            return `<li><a href="${escapeHtml(e.url)}" target="_blank" rel="noreferrer">${escapeHtml(e.label || 'source')}</a>${recency ? ` <span class="source-recency">(${escapeHtml(recency)})</span>` : ''}</li>`;
          }).join('');
          return `
            <button class="tracker-section-toggle expanded" data-links-toggle-id="${escapeHtml(item.id)}">
              <span class="chevron chevron--expanded">&#9654;</span> Links (${links.length})
            </button>
            <div class="tracker-section-panel show" data-links-panel-id="${escapeHtml(item.id)}">
              <ul class="source-list">${linksHtml}</ul>
            </div>`;
        })()}

        <button class="tracker-section-toggle" data-monitoring-toggle-id="${escapeHtml(item.id)}">
          <span class="chevron">&#9654;</span> Monitoring
        </button>
        <div class="tracker-section-panel" data-monitoring-panel-id="${escapeHtml(item.id)}">
          <div class="tracker-schedule-bar">
            <div class="tracking-inline">
              <label><input type="checkbox" data-monitor-enabled-id="${escapeHtml(item.id)}" ${item.monitorEnabled !== false ? 'checked' : ''} /> Enabled</label>
              <label><input type="checkbox" data-notify-enabled-id="${escapeHtml(item.id)}" ${item.notifyEnabled !== false ? 'checked' : ''} /> Notifications</label>
              ${buildWorkHoursToggleHtml(item)}
              ${buildScheduleControlsHtml(item)}
              <button class="small-btn" data-monitor-run-now-id="${escapeHtml(item.id)}">Run check now</button>
            </div>
            ${buildSignalFilterHtml(item)}
            <p class="task-next-run">Next run: ${escapeHtml(safeDate(item.nextRunAt, 'Not scheduled'))}</p>
            <button class="tracker-prompt-toggle" data-prompt-toggle-id="${escapeHtml(item.id)}">
              <span class="chevron">&#9654;</span> Edit monitoring prompt
            </button>
            <div class="tracker-prompt-panel" data-prompt-panel-id="${escapeHtml(item.id)}">
              <textarea class="tracking-textarea" data-monitor-prompt-id="${escapeHtml(item.id)}" placeholder="Monitoring context for WorkIQ">${escapeHtml(item.monitorPrompt || '')}</textarea>
            </div>
          </div>
        </div>


        <div class="action-row">
          ${(hasNew || unseenCount > 0) ? `<button class="small-btn primary" data-mark-seen-id="${escapeHtml(item.id)}">Mark as Seen</button>` : ''}
          <button class="small-btn popout" data-popout-id="${escapeHtml(item.id)}">&#x2197; Pop Out</button>
          <button class="small-btn warn" data-dismiss-radar-id="${escapeHtml(item.id)}">Delete</button>
        </div>
      </div>
    </article>
  `;
  }).join('');

  autoSizeSeveritySelects(elements.trackingList);
  restoreTrackingUiState(savedUiState);
  // Enforce schedule-control visibility via DOM API — inline style attributes
  // from the HTML template are not reliably applied after innerHTML replacement.
  sortedItems.forEach(item => {
    inlineUpdateScheduleControls(elements.trackingList, item.id, item.scheduleType);
  });
  renderKpis();
}; // end dead code
