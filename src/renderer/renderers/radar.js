// ── Unified rendering — all items in one pane ────────────────────────

// ── UI state helpers ─────────────────────────────────────────────────
function captureRadarUiState() {
  const container = elements.radarList;
  // Capture tracker row expansion state
  const expandedRowId = container.querySelector('.tracker-row-detail.show')?.parentElement?.getAttribute('data-tracker-id') || null;

  // Capture active tab per card
  const tabStates = {};
  container.querySelectorAll('.card-tab.active').forEach((tab) => {
    const itemId = tab.getAttribute('data-card-tab-item-id');
    if (itemId) tabStates[itemId] = tab.getAttribute('data-card-tab');
  });

  // Capture prompt panel states
  const promptStates = {};
  container.querySelectorAll('[data-prompt-panel-id]').forEach((panel) => {
    const id = panel.getAttribute('data-prompt-panel-id');
    if (id) promptStates[id] = panel.classList.contains('show');
  });

  const scrollTop = container.scrollTop;
  return { expandedRowId, tabStates, promptStates, scrollTop };
}

function restoreRadarUiState(saved) {
  const container = elements.radarList;
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

  // Restore active tab per card
  for (const [itemId, activeTab] of Object.entries(saved.tabStates || {})) {
    const tabContainer = container.querySelector(`[data-card-tabs-id="${CSS.escape(itemId)}"]`);
    if (!tabContainer) continue;
    tabContainer.querySelectorAll('.card-tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-card-tab') === activeTab));
    tabContainer.querySelectorAll('.card-tab-panel').forEach((p) => p.classList.toggle('active', p.getAttribute('data-card-tab-panel') === activeTab));
  }

  // Restore prompt panel states
  for (const [itemId, isOpen] of Object.entries(saved.promptStates || {})) {
    const panel = container.querySelector(`[data-prompt-panel-id="${CSS.escape(itemId)}"]`);
    const toggle = container.querySelector(`[data-prompt-toggle-id="${CSS.escape(itemId)}"]`);
    if (panel) {
      panel.classList.toggle('show', isOpen);
      if (toggle) {
        toggle.classList.toggle('expanded', isOpen);
        const chevron = toggle.querySelector('.chevron');
        if (chevron) chevron.classList.toggle('chevron--expanded', isOpen);
      }
    }
  }

  if (saved.scrollTop) container.scrollTop = saved.scrollTop;
}

// ── Filtering ────────────────────────────────────────────────────────
function applyFilter(items) {
  switch (state.filter) {
    case 'in-progress':
      return items.filter((item) => item.lifecycleStatus === 'in-progress');
    case 'blocked':
      return items.filter((item) => item.lifecycleStatus === 'blocked');
    case 'waiting':
      return items.filter((item) => item.lifecycleStatus === 'waiting');
    case 'monitored':
      return items.filter((item) => item.monitorEnabled && item.lifecycleStatus !== 'complete' && item.lifecycleStatus !== 'archived');
    case 'archived':
      return items.filter((item) => item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived');
    default: // 'all'
      return items.filter((item) => item.lifecycleStatus !== 'complete' && item.lifecycleStatus !== 'archived');
  }
}

// ── Grouped sections (from scanner branch) ───────────────────────────
function groupItemsBySource(filteredItems) {
  const scannerGroups = new Map();
  const scanners = Array.isArray(state.scanners) ? state.scanners : [];

  // Sort scanners: default first, then by enabled + severity
  const sortedScanners = [...scanners].sort((a, b) => {
    if (a.isDefault !== b.isDefault) return a.isDefault ? -1 : 1;
    const aEnabled = a.enabled !== false;
    const bEnabled = b.enabled !== false;
    if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;
    return 0;
  });

  for (const scanner of sortedScanners) {
    scannerGroups.set(scanner.id, { scanner, items: [] });
  }

  // Orphaned items (no scanner match) go into default radar scanner
  const defaultScanner = scanners.find((s) => s.isDefault);

  for (const item of filteredItems) {
    if (item.scannerId && scannerGroups.has(item.scannerId)) {
      scannerGroups.get(item.scannerId).items.push(item);
    } else if (defaultScanner && scannerGroups.has(defaultScanner.id)) {
      scannerGroups.get(defaultScanner.id).items.push(item);
    }
  }

  return { scannerGroups: [...scannerGroups.values()] };
}

// ── Section header (from scanner branch) ─────────────────────────────
function buildSectionHeader(sourceId, icon, name, count, { scannerId = null, enabled = true, isDefault = false } = {}) {
  const collapsed = Array.isArray(state.collapsedSections) && state.collapsedSections.includes(sourceId);
  return `
    <div class="radar-section-header ${enabled ? '' : 'disabled'}" data-source-id="${escapeHtml(sourceId)}">
      <div class="radar-section-header-left">
        <span class="radar-section-icon">${icon}</span>
        <span class="radar-section-name">${escapeHtml(name)}</span>
        <span class="radar-section-count">(${count})</span>
      </div>
      <div class="radar-section-header-actions">
        <button class="icon-btn" data-scanner-header-toggle="${escapeHtml(String(scannerId))}" title="${enabled ? 'Pause scanner' : 'Resume scanner'}">${enabled ? '\u23f8' : '\u25b6'}</button>
        <button class="icon-btn" data-scanner-header-settings="${escapeHtml(String(scannerId))}" title="Scanner settings">\u2699\ufe0f</button>
        <button class="icon-btn radar-section-collapse ${collapsed ? 'collapsed' : ''}" data-section-collapse="${escapeHtml(sourceId)}" title="${collapsed ? 'Expand' : 'Collapse'}">\u25be</button>
      </div>
    </div>
  `;
}

// ── Main render ──────────────────────────────────────────────────────
function renderRadarList() {
  const allItems = Array.isArray(state.items) ? state.items : [];
  const filtered = applyFilter(allItems);

  if (!filtered.length) {
    const emptyMsg = state.filter === 'all'
      ? 'No items yet. Click Refresh to scan or add a custom monitored task above.'
      : 'No items matching the current filter.';
    elements.radarList.innerHTML = `<div class="empty">${escapeHtml(emptyMsg)}</div>`;
    return;
  }

  const sorted = sortBySeverity(filtered, true);

  // Sync density toggle
  const densityBtn = document.getElementById('densityToggleBtn');
  if (densityBtn) {
    densityBtn.classList.toggle('is-minimal', state.density === 'minimal');
    densityBtn.title = state.density === 'minimal' ? 'Switch to card view' : 'Switch to list view';
  }

  // Sync filter bar
  const filterBar = document.getElementById('filterBar');
  if (filterBar) {
    filterBar.querySelectorAll('.filter-btn').forEach((btn) => {
      btn.classList.toggle('active', btn.dataset.filter === state.filter);
    });
  }

  const isMinimal = state.density === 'minimal';
  // Remove legacy class — sections handle their own grid
  elements.radarList.classList.remove('list--minimal');

  // Capture UI state before re-render
  const savedUiState = captureRadarUiState();

  const { scannerGroups } = groupItemsBySource(sorted);

  let html = '';

  // All sections (default radar scanner is first due to sorting)
  for (const group of scannerGroups) {
    const scanner = group.scanner;
    const sourceId = `scanner-${scanner.id}`;
    const enabled = scanner.enabled !== false;
    const collapsed = Array.isArray(state.collapsedSections) && state.collapsedSections.includes(sourceId);
    const icon = scanner.isDefault ? '\uD83D\uDCE1' : '\uD83D\uDD0D';

    html += `<div class="radar-section ${enabled ? '' : 'disabled'}">`;
    html += buildSectionHeader(sourceId, icon, scanner.name || 'Unnamed Scanner', group.items.length, {
      scannerId: scanner.id,
      enabled,
      isDefault: scanner.isDefault,
    });
    html += `<div class="radar-section-items ${isMinimal ? 'list--minimal' : ''} ${collapsed ? 'collapsed' : ''}" data-section-items="${escapeHtml(sourceId)}">`;
    html += group.items.length
      ? group.items.map((item) => isMinimal ? buildTrackingRow(item, savedUiState.expandedRowId) : buildTrackingCard(item)).join('')
      : `<div class="empty">No items from ${escapeHtml(scanner.name || 'this scanner')}.</div>`;
    html += `</div></div>`;
  }

  // Suppress transition/animation flash during full DOM rebuild
  elements.radarList.classList.add('no-transition');
  elements.radarList.innerHTML = html;
  autoSizeSeveritySelects(elements.radarList);
  restoreRadarUiState(savedUiState);
  // Re-enable transitions after the browser has painted
  requestAnimationFrame(() => {
    elements.radarList.classList.remove('no-transition');
  });

  // Enforce schedule-control visibility
  filtered.forEach((item) => {
    inlineUpdateScheduleControls(elements.radarList, item.id, item.scheduleType);
  });
}

// ── Scanner settings modal ───────────────────────────────────────────
function renderScannerSettingsModal(scannerId) {
  const modal = document.getElementById('scannerSettingsModal');
  if (!modal) return;
  const scanner = scannerId ? getScannerById(scannerId) : null;
  const isEdit = scanner != null;
  const isDefaultRadar = isEdit && scanner.isDefault;
  const title = isEdit ? escapeHtml(scanner.name || 'Scanner Settings') : 'New Scanner';

  // For the default radar scanner, pre-fill prompt from promptCache
  if (isDefaultRadar && scanner) {
    scanner._displayPrompt = promptCache.radarScan || scanner.prompt || '';
  }

  const formScanner = isDefaultRadar
    ? { ...scanner, prompt: scanner._displayPrompt || promptCache.radarScan || '' }
    : scanner;

  modal.innerHTML = `
    <div class="modal-card">
      <h3 class="scanner-modal-title">${title}</h3>
      ${buildScannerForm(formScanner)}
      ${isEdit && !isDefaultRadar ? `<button class="scanner-modal-delete" data-scanner-modal-delete="${escapeHtml(String(scannerId))}">Delete this scanner</button>` : ''}
    </div>
  `;

  // Replace form save/cancel buttons to include Run Now for edit mode
  if (isEdit) {
    const actions = modal.querySelector('.scanner-form-actions');
    if (actions) {
      actions.innerHTML = `
        <button class="small-btn primary" data-scanner-save="${escapeHtml(String(scannerId))}">Update Scanner</button>
        <button class="small-btn" data-scanner-run-now="${escapeHtml(String(scannerId))}">Run Now</button>
        ${isDefaultRadar ? '<button class="small-btn" data-radar-prompt-reset>Reset Prompt to Default</button>' : ''}
        <button class="small-btn" data-scanner-modal-close>Cancel</button>
      `;
    }
  } else {
    const actions = modal.querySelector('.scanner-form-actions');
    if (actions) {
      actions.innerHTML = `
        <button class="small-btn primary" data-scanner-save="">Create Scanner</button>
        <button class="small-btn" data-scanner-modal-close>Cancel</button>
      `;
    }
  }

  // For default radar scanner, make name readonly
  if (isDefaultRadar) {
    const nameInput = modal.querySelector('[data-scanner-input="name"]');
    if (nameInput) nameInput.readOnly = true;
  }

  // Bind schedule type change within the form
  const form = modal.querySelector('.scanner-form');
  if (form) {
    const typeSelect = form.querySelector('[data-scanner-input="scheduleType"]');
    if (typeSelect) {
      typeSelect.addEventListener('change', () => {
        const intervalField = form.querySelector('[data-scanner-interval-field]');
        const weeklyPanel = form.querySelector('[data-scanner-weekly-panel]');
        if (intervalField) intervalField.classList.toggle('d-none', typeSelect.value !== 'interval');
        if (weeklyPanel) weeklyPanel.classList.toggle('d-none', typeSelect.value !== 'weekly');
      });
    }

    // Bind monitor schedule type change
    const monitorTypeSelect = form.querySelector('[data-scanner-input="defaultMonitorScheduleType"]');
    if (monitorTypeSelect) {
      monitorTypeSelect.addEventListener('change', () => {
        const intervalField = form.querySelector('[data-monitor-interval-field]');
        const weeklyPanel = form.querySelector('[data-monitor-weekly-panel]');
        if (intervalField) intervalField.classList.toggle('d-none', monitorTypeSelect.value !== 'interval');
        if (weeklyPanel) weeklyPanel.classList.toggle('d-none', monitorTypeSelect.value !== 'weekly');
      });
    }
  }

  modal.classList.add('show');
}

function closeScannerSettingsModal() {
  const modal = document.getElementById('scannerSettingsModal');
  if (modal) {
    modal.classList.remove('show');
    modal.innerHTML = '';
  }
}

function readScannerModalFormValues() {
  const modal = document.getElementById('scannerSettingsModal');
  if (!modal) return null;
  const form = modal.querySelector('.scanner-form');
  if (!form) return null;

  const nameInput = form.querySelector('[data-scanner-input="name"]');
  const promptInput = form.querySelector('[data-scanner-input="prompt"]');
  const typeSelect = form.querySelector('[data-scanner-input="scheduleType"]');
  const valueSelect = form.querySelector('[data-scanner-input="scheduleValue"]');
  const notificationSelect = form.querySelector('[data-scanner-input="notificationMode"]');
  const autoMonitorCb = form.querySelector('[data-scanner-input="autoMonitorNewItems"]');
  const workHoursCb = form.querySelector('[data-scanner-input="workHoursOnly"]');
  const crossDedupCb = form.querySelector('[data-scanner-input="crossScannerDedup"]');
  const runOnStartupCb = form.querySelector('[data-scanner-input="runOnStartup"]');
  const thresholdSelect = form.querySelector('[data-scanner-input="autoMonitorSeverityThreshold"]');
  const maxItemsInput = form.querySelector('[data-scanner-input="maxItemsPerScan"]');
  const missedRunSelect = form.querySelector('[data-scanner-input="missedRunPolicy"]');
  const dedupSelect = form.querySelector('[data-scanner-input="dedupStrategy"]');
  const excludeKwInput = form.querySelector('[data-scanner-input="excludeKeywords"]');
  const defaultMonitorSelect = form.querySelector('[data-scanner-input="defaultMonitorSchedule"]');
  const defaultMonitorTypeSelect = form.querySelector('[data-scanner-input="defaultMonitorScheduleType"]');
  const defaultMonitorWorkHoursCb = form.querySelector('[data-scanner-input="defaultMonitorWorkHoursOnly"]');
  const defaultMonitorNotifyCb = form.querySelector('[data-scanner-input="defaultMonitorNotifyEnabled"]');
  const autoArchiveInput = form.querySelector('[data-scanner-input="autoArchiveAfterDays"]');
  const retentionInput = form.querySelector('[data-scanner-input="retentionDays"]');
  const webhookInput = form.querySelector('[data-scanner-input="webhookUrl"]');
  const groupInput = form.querySelector('[data-scanner-input="scannerGroupId"]');

  const values = {
    name: nameInput?.value?.trim() || '',
    prompt: promptInput?.value?.trim() || '',
    scheduleType: typeSelect?.value || 'interval',
    scheduleValue: valueSelect?.value || '4h',
    notificationMode: notificationSelect?.value || 'all',
    autoMonitorNewItems: autoMonitorCb?.checked === true,
    workHoursOnly: workHoursCb?.checked === true,
    crossScannerDedup: crossDedupCb?.checked !== false,
    runOnStartup: runOnStartupCb?.checked === true,
    autoMonitorSeverityThreshold: thresholdSelect?.value || 'all',
    maxItemsPerScan: Number(maxItemsInput?.value) || 10,
    missedRunPolicy: missedRunSelect?.value || 'run-once',
    dedupStrategy: dedupSelect?.value || 'evidence-url',
    excludeKeywords: (excludeKwInput?.value || '').split(',').map((s) => s.trim()).filter(Boolean),
    defaultMonitorSchedule: defaultMonitorSelect?.value || '30m',
    defaultMonitorScheduleType: defaultMonitorTypeSelect?.value || 'interval',
    defaultMonitorWorkHoursOnly: defaultMonitorWorkHoursCb?.checked === true,
    defaultMonitorNotifyEnabled: defaultMonitorNotifyCb?.checked !== false,
    autoArchiveAfterDays: Number(autoArchiveInput?.value) || 0,
    retentionDays: Number(retentionInput?.value) || 365,
    webhookUrl: webhookInput?.value?.trim() || '',
    scannerGroupId: groupInput?.value?.trim() || '',
  };

  // Signal types checkboxes
  const signalCbs = form.querySelectorAll('[data-scanner-signal-type]:checked');
  values.signalTypes = [...signalCbs].map((cb) => cb.value).filter(Boolean);
  if (!values.signalTypes.length) values.signalTypes = [...ALL_SIGNAL_TYPES];

  // Monitor signal types checkboxes
  const monitorSignalCbs = form.querySelectorAll('[data-scanner-monitor-signal-type]:checked');
  values.defaultMonitorSignals = [...monitorSignalCbs].map((cb) => cb.value).filter(Boolean);
  if (!values.defaultMonitorSignals.length) values.defaultMonitorSignals = [...ALL_SIGNAL_TYPES];

  if (values.scheduleType === 'weekly') {
    const dayCbs = form.querySelectorAll('[data-scanner-weekly-day]:checked');
    values.weeklyDays = [...dayCbs].map((cb) => cb.value).filter(Boolean);
    if (!values.weeklyDays.length) values.weeklyDays = [...DEFAULT_WEEKLY_DAYS];

    const timePickers = form.querySelectorAll('[data-scanner-weekly-time]');
    values.weeklyTimes = [...timePickers].map((inp) => inp.value).filter(Boolean);
    if (!values.weeklyTimes.length) values.weeklyTimes = [...DEFAULT_WEEKLY_TIMES];
  }

  // Monitor weekly defaults
  if (values.defaultMonitorScheduleType === 'weekly') {
    const monDayCbs = form.querySelectorAll('[data-scanner-monitor-weekly-day]:checked');
    values.defaultMonitorWeeklyDays = [...monDayCbs].map((cb) => cb.value).filter(Boolean);
    if (!values.defaultMonitorWeeklyDays.length) values.defaultMonitorWeeklyDays = [...DEFAULT_WEEKLY_DAYS];

    const monTimePickers = form.querySelectorAll('[data-scanner-monitor-weekly-time]');
    values.defaultMonitorWeeklyTimes = [...monTimePickers].map((inp) => inp.value).filter(Boolean);
    if (!values.defaultMonitorWeeklyTimes.length) values.defaultMonitorWeeklyTimes = [...DEFAULT_WEEKLY_TIMES];
  }

  return values;
}

/**
 * Incrementally patch a single item's DOM node in-place.
 * Returns true if the item was found and updated, false if a full
 * re-render is needed (item not in DOM or filtered out).
 */
function patchSingleItem(itemId) {
  const container = elements.radarList;
  const existing = container.querySelector(`[data-tracker-id="${CSS.escape(itemId)}"]`);
  if (!existing) return false;

  const item = state.items.find((i) => i.id === itemId);
  if (!item) return false;

  // If item no longer matches the active filter, remove it from DOM
  const filtered = applyFilter([item]);
  if (!filtered.length) {
    existing.remove();
    return true;
  }

  const isMinimal = state.density === 'minimal';

  // Capture per-item UI state before replacement
  const wasExpanded = isMinimal
    ? Boolean(existing.querySelector('.tracker-row-detail.show'))
    : false;
  const expandedRowId = wasExpanded ? itemId : null;

  const tabStates = {};
  existing.querySelectorAll('.card-tab.active').forEach((tab) => {
    const tid = tab.getAttribute('data-card-tab-item-id');
    if (tid) tabStates[tid] = tab.getAttribute('data-card-tab');
  });

  const promptStates = {};
  existing.querySelectorAll('[data-prompt-panel-id]').forEach((panel) => {
    const pid = panel.getAttribute('data-prompt-panel-id');
    if (pid) promptStates[pid] = panel.classList.contains('show');
  });

  // Capture section-panel expansion (people, links, monitoring, etc.)
  const sectionStates = {};
  const panelAttrs = ['people', 'links', 'monitoring', 'history'];
  for (const attr of panelAttrs) {
    const panel = existing.querySelector(`[data-${attr}-panel-id="${CSS.escape(itemId)}"]`);
    if (panel) sectionStates[attr] = panel.classList.contains('show');
  }

  // Build replacement HTML
  const newHtml = isMinimal ? buildTrackingRow(item, expandedRowId) : buildTrackingCard(item);
  const temp = document.createElement('div');
  temp.innerHTML = newHtml;
  const newEl = temp.firstElementChild;
  if (!newEl) return false;

  // Suppress transitions/animations on the freshly inserted element
  newEl.classList.add('no-transition');
  existing.replaceWith(newEl);
  autoSizeSeveritySelects(newEl);

  // Restore tab states
  for (const [tid, activeTab] of Object.entries(tabStates)) {
    const tabContainer = newEl.querySelector(`[data-card-tabs-id="${CSS.escape(tid)}"]`);
    if (!tabContainer) continue;
    tabContainer.querySelectorAll('.card-tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-card-tab') === activeTab));
    tabContainer.querySelectorAll('.card-tab-panel').forEach((p) => p.classList.toggle('active', p.getAttribute('data-card-tab-panel') === activeTab));
  }

  // Restore prompt panel states
  for (const [pid, isOpen] of Object.entries(promptStates)) {
    const pPanel = newEl.querySelector(`[data-prompt-panel-id="${CSS.escape(pid)}"]`);
    const pToggle = newEl.querySelector(`[data-prompt-toggle-id="${CSS.escape(pid)}"]`);
    if (pPanel) {
      pPanel.classList.toggle('show', isOpen);
      if (pToggle) {
        pToggle.classList.toggle('expanded', isOpen);
        const chevron = pToggle.querySelector('.chevron');
        if (chevron) chevron.classList.toggle('chevron--expanded', isOpen);
      }
    }
  }

  // Restore section-panel states (people, links, monitoring, etc.)
  for (const [attr, isOpen] of Object.entries(sectionStates)) {
    const panel = newEl.querySelector(`[data-${attr}-panel-id="${CSS.escape(itemId)}"]`);
    const toggle = newEl.querySelector(`[data-${attr}-toggle-id="${CSS.escape(itemId)}"]`);
    if (panel) {
      panel.classList.toggle('show', isOpen);
      if (toggle) {
        toggle.classList.toggle('expanded', isOpen);
        const chevron = toggle.querySelector('.chevron');
        if (chevron) chevron.classList.toggle('chevron--expanded', isOpen);
      }
    }
  }

  inlineUpdateScheduleControls(container, itemId, item.scheduleType);

  // Re-enable transitions after the browser paints the new element
  requestAnimationFrame(() => {
    newEl.classList.remove('no-transition');
  });

  return true;
}

function renderRadarMode() {
  renderRadarList();
  renderKpis();
}
