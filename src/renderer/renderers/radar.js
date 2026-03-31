// ── Unified rendering — all items in one pane ────────────────────────

// ── DOM-based inline filter (no rebuild) ─────────────────────────────
function applyInlineFilterDOM(sourceId) {
  const filter = state.scannerFilters?.[sourceId] || null;
  const section = elements.radarList.querySelector(`[data-section-items="${CSS.escape(sourceId)}"]`);
  if (!section) return;

  // Show/hide items based on filter
  const items = section.querySelectorAll('[data-item-severity]');
  let visibleCount = 0;
  items.forEach((el) => {
    let show = true;
    if (filter) {
      if (filter.type === 'severity') show = el.getAttribute('data-item-severity') === filter.value;
      else if (filter.type === 'status') show = el.getAttribute('data-item-status') === filter.value;
      else if (filter.type === 'new') show = el.getAttribute('data-item-new') === 'true';
    }
    el.style.display = show ? '' : 'none';
    if (show) visibleCount++;
  });

  // Handle empty state
  let emptyEl = section.querySelector('.inline-filter-empty');
  if (filter && visibleCount === 0 && items.length > 0) {
    if (!emptyEl) {
      emptyEl = document.createElement('div');
      emptyEl.className = 'empty inline-filter-empty';
      emptyEl.textContent = 'No items matching filter.';
      section.appendChild(emptyEl);
    }
    emptyEl.style.display = '';
  } else if (emptyEl) {
    emptyEl.style.display = 'none';
  }

  // Update pill active states in the header
  const header = elements.radarList.querySelector(`[data-source-id="${CSS.escape(sourceId)}"]`);
  if (!header) return;

  header.querySelectorAll('[data-scanner-filter]').forEach((pill) => {
    const attr = pill.getAttribute('data-scanner-filter');
    let pillType, pillValue;
    if (attr === 'new') { pillType = 'new'; pillValue = 'new'; }
    else { const p = attr.split(':'); pillType = p[0]; pillValue = p.slice(1).join(':'); }
    pill.classList.toggle('active', filter !== null && filter.type === pillType && filter.value === pillValue);
  });

  // Toggle clear button
  let clearBtn = header.querySelector('.scanner-filter-clear');
  if (filter && !clearBtn) {
    clearBtn = document.createElement('span');
    clearBtn.className = 'scanner-filter-clear';
    clearBtn.setAttribute('data-scanner-filter-clear', sourceId);
    clearBtn.title = 'Clear filter';
    clearBtn.innerHTML = '&times;';
    const left = header.querySelector('.radar-section-header-left');
    if (left) left.appendChild(clearBtn);
  } else if (!filter && clearBtn) {
    clearBtn.remove();
  }
}

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
function buildSectionHeader(sourceId, icon, name, count, { scannerId = null, enabled = true, isDefault = false, items = [] } = {}) {
  const collapsed = Array.isArray(state.collapsedSections) && state.collapsedSections.includes(sourceId);

  // Severity micro-counts
  let critical = 0, elevated = 0, observe = 0;
  let blocked = 0, waiting = 0, newCount = 0;
  let latestActivity = 0;
  for (const item of items) {
    if (item.severity === 'Critical') critical++;
    else if (item.severity === 'Elevated') elevated++;
    else observe++;
    if (item.lifecycleStatus === 'blocked') blocked++;
    if (item.lifecycleStatus === 'waiting') waiting++;
    if ((item.isNew || item.hasNewUpdate) && item.lifecycleStatus !== 'complete' && item.lifecycleStatus !== 'archived') newCount++;
    const ts = new Date(item.lastChangedAt || item.lastRunAt || 0).getTime();
    if (ts > latestActivity) latestActivity = ts;
  }

  const highestSev = critical > 0 ? 'critical' : elevated > 0 ? 'elevated' : items.length > 0 ? 'observe' : '';
  const sevBorderClass = highestSev ? `sev-border-${highestSev}` : '';

  // Active inline filter for this scanner
  const activeFilter = state.scannerFilters?.[sourceId] || null;
  const isFilterActive = (type, value) => activeFilter && activeFilter.type === type && activeFilter.value === value;

  // Severity dots
  let sevDots = '';
  if (critical > 0) sevDots += `<span class="radar-sev-dot sev-critical${isFilterActive('severity', 'Critical') ? ' active' : ''}" data-scanner-filter="severity:Critical" data-scanner-source-id="${escapeHtml(sourceId)}" title="${critical} Critical — click to filter">${critical}</span>`;
  if (elevated > 0) sevDots += `<span class="radar-sev-dot sev-elevated${isFilterActive('severity', 'Elevated') ? ' active' : ''}" data-scanner-filter="severity:Elevated" data-scanner-source-id="${escapeHtml(sourceId)}" title="${elevated} Elevated — click to filter">${elevated}</span>`;
  if (observe > 0) sevDots += `<span class="radar-sev-dot sev-observe${isFilterActive('severity', 'Observe') ? ' active' : ''}" data-scanner-filter="severity:Observe" data-scanner-source-id="${escapeHtml(sourceId)}" title="${observe} Observe — click to filter">${observe}</span>`;

  // Attention badges (blocked/waiting)
  let attentionHtml = '';
  if (blocked > 0) attentionHtml += `<span class="radar-attn-badge attn-blocked${isFilterActive('status', 'blocked') ? ' active' : ''}" data-scanner-filter="status:blocked" data-scanner-source-id="${escapeHtml(sourceId)}" title="${blocked} blocked — click to filter">${blocked} blocked</span>`;
  if (waiting > 0) attentionHtml += `<span class="radar-attn-badge attn-waiting${isFilterActive('status', 'waiting') ? ' active' : ''}" data-scanner-filter="status:waiting" data-scanner-source-id="${escapeHtml(sourceId)}" title="${waiting} waiting — click to filter">${waiting} waiting</span>`;

  // New indicator
  const newHtml = newCount > 0 ? `<span class="radar-new-indicator${isFilterActive('new', 'new') ? ' active' : ''}" data-scanner-filter="new" data-scanner-source-id="${escapeHtml(sourceId)}" title="${newCount} new or updated — click to filter">${newCount} new</span>` : '';

  // Clear filter button (only shown when a filter is active)
  const clearHtml = activeFilter ? `<span class="scanner-filter-clear" data-scanner-filter-clear="${escapeHtml(sourceId)}" title="Clear filter">&times;</span>` : '';

  // Last activity
  const activityHtml = latestActivity > 0 ? `<span class="radar-last-activity">${escapeHtml(relativeTime(latestActivity) || '')}</span>` : '';

  return `
    <div class="radar-section-header ${enabled ? '' : 'disabled'} ${sevBorderClass}" data-source-id="${escapeHtml(sourceId)}">
      <div class="radar-section-header-left">
        <span class="radar-section-icon">${icon}</span>
        <span class="radar-section-name">${escapeHtml(name)}</span>
        <span class="radar-section-count">(${count})</span>
        ${sevDots ? `<span class="radar-sev-dots">${sevDots}</span>` : ''}
        ${attentionHtml}
        ${newHtml}
        ${clearHtml}
        ${activityHtml}
      </div>
      <div class="radar-section-header-actions">
        <button class="icon-btn" data-scanner-add-item="${escapeHtml(String(scannerId))}" title="Add item to this scanner"><svg width="12" height="12" viewBox="0 0 14 14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="7" y1="1" x2="7" y2="13"/><line x1="1" y1="7" x2="13" y2="7"/></svg></button>
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
  _renderRadarListFromItems(allItems);

  // When viewing archived items, also fetch cold storage items and re-render
  // with the merged set. The initial render shows hot archived items instantly;
  // cold items appear once the async IPC call completes.
  if (state.filter === 'archived' && window.workiq && typeof window.workiq.getColdItems === 'function') {
    window.workiq.getColdItems().then((coldItems) => {
      if (!Array.isArray(coldItems) || !coldItems.length) return;
      // Only re-render if still on the archived filter
      if (state.filter !== 'archived') return;
      const hotIds = new Set(allItems.map((i) => i.id));
      const uniqueCold = coldItems
        .map((c) => normalizeItem(c))
        .filter((c) => !hotIds.has(c.id));
      if (!uniqueCold.length) return;
      _renderRadarListFromItems([...allItems, ...uniqueCold]);
    }).catch(() => {});
  }
}

function _renderRadarListFromItems(allItems) {
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
      items: group.items,
    });

    // Always render ALL items — inline filter is applied via DOM show/hide after render
    html += `<div class="radar-section-items ${isMinimal ? 'list--minimal' : ''} ${collapsed ? 'collapsed' : ''}" data-section-items="${escapeHtml(sourceId)}">`;
    html += group.items.length
      ? group.items.map((item) => isMinimal ? buildTrackingRow(item, savedUiState.expandedRowId) : buildTrackingCard(item)).join('')
      : `<div class="empty">No items from ${escapeHtml(scanner.name || 'this scanner')}.</div>`;
    html += `</div></div>`;
  }

  // Suppress transition/animation flash during full DOM rebuild
  elements.radarList.classList.add('no-transition');

  // Lock container height to prevent scroll bounce during innerHTML swap.
  // The page scrolls via <body>/<html>, not radarList, so we lock radarList's
  // min-height to its current rendered size to prevent the viewport from
  // collapsing and snapping the window scroll position to 0.
  const prevScrollY = window.scrollY;
  const prevHeight = elements.radarList.offsetHeight;
  if (prevHeight > 0) {
    elements.radarList.style.minHeight = prevHeight + 'px';
  }

  elements.radarList.innerHTML = html;
  autoSizeSeveritySelects(elements.radarList);
  applyTimelineDelays(elements.radarList);
  restoreRadarUiState(savedUiState);

  // Apply any active inline filters via DOM show/hide (no second rebuild)
  for (const sourceId of Object.keys(state.scannerFilters || {})) {
    applyInlineFilterDOM(sourceId);
  }

  // Restore window scroll synchronously before any repaint
  window.scrollTo(0, prevScrollY);
  elements.radarList.style.minHeight = '';

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

// ── Add Task modal ───────────────────────────────────────────────────
function renderAddTaskModal(scannerId) {
  const modal = document.getElementById('addTaskModal');
  if (!modal) return;

  const scanner = scannerId ? getScannerById(scannerId) : null;
  const scannerName = scanner ? (scanner.name || 'Unnamed Scanner') : 'Radar';

  // Build scanner picker options
  const scanners = Array.isArray(state.scanners) ? state.scanners : [];
  const scannerOptions = scanners.map((s) => {
    const selected = s.id === scannerId ? ' selected' : '';
    const label = s.isDefault ? `${escapeHtml(s.name || 'Radar')} (default)` : escapeHtml(s.name || 'Unnamed');
    return `<option value="${escapeHtml(s.id)}"${selected}>${label}</option>`;
  }).join('');

  modal.innerHTML = `
    <div class="modal-card">
      <h3>Add Item to ${escapeHtml(scannerName)}</h3>
      <div class="add-task-modal-form">
        <div class="add-task-modal-row">
          <div class="add-task-field add-task-field-grow">
            <label class="add-task-label" for="modalTaskTitle">Title</label>
            <input id="modalTaskTitle" class="tracking-input" type="text" placeholder="e.g., Customer agreement for Project X" autofocus />
          </div>
        </div>
        <div class="add-task-modal-row">
          <div class="add-task-field">
            <label class="add-task-label" for="modalTaskScanner">Scanner</label>
            <select id="modalTaskScanner" class="tracking-select">${scannerOptions}</select>
          </div>
          <div class="add-task-field">
            <label class="add-task-label" for="modalTaskSeverity">Severity</label>
            <select id="modalTaskSeverity" class="tracking-select">
              <option value="Observe" selected>Observe</option>
              <option value="Elevated">Elevated</option>
              <option value="Critical">Critical</option>
            </select>
          </div>
          <div class="add-task-field">
            <label class="add-task-label" for="modalTaskScheduleType">Schedule</label>
            <select id="modalTaskScheduleType" class="tracking-select">
              <option value="interval">Interval</option>
              <option value="weekly">Scheduled</option>
              <option value="one-time">One-time</option>
            </select>
          </div>
          <div class="add-task-field" id="modalTaskIntervalField">
            <label class="add-task-label" for="modalTaskScheduleValue">Interval</label>
            <select id="modalTaskScheduleValue" class="tracking-select">
              <option value="15m">Every 15m</option>
              <option value="30m" selected>Every 30m</option>
              <option value="1h">Every 1h</option>
              <option value="2h">Every 2h</option>
              <option value="4h">Every 4h</option>
            </select>
          </div>
          <div class="add-task-field d-none" id="modalTaskOneTimeField">
            <label class="add-task-label" for="modalTaskOneTimeAt">Run at</label>
            <input id="modalTaskOneTimeAt" class="tracking-input" type="datetime-local" />
          </div>
        </div>
        <div class="add-task-modal-row d-none" id="modalTaskWeeklyPanel">
          <div class="add-task-field">
            <label class="add-task-label">Days &amp; Times</label>
            <div class="weekly-days-row">
              <label class="weekly-day-label active"><input type="checkbox" class="modal-weekly-day-cb" value="mon" checked />Mon</label>
              <label class="weekly-day-label active"><input type="checkbox" class="modal-weekly-day-cb" value="tue" checked />Tue</label>
              <label class="weekly-day-label active"><input type="checkbox" class="modal-weekly-day-cb" value="wed" checked />Wed</label>
              <label class="weekly-day-label active"><input type="checkbox" class="modal-weekly-day-cb" value="thu" checked />Thu</label>
              <label class="weekly-day-label active"><input type="checkbox" class="modal-weekly-day-cb" value="fri" checked />Fri</label>
              <label class="weekly-day-label"><input type="checkbox" class="modal-weekly-day-cb" value="sat" />Sat</label>
              <label class="weekly-day-label"><input type="checkbox" class="modal-weekly-day-cb" value="sun" />Sun</label>
            </div>
            <div class="weekly-times-row">
              <label class="add-task-label">Times</label>
              <div class="weekly-time-slots" id="modalTaskTimeSlots">
                <div class="weekly-time-slot">
                  <input type="time" class="tracking-input weekly-time-picker" value="08:00" />
                </div>
                <div class="weekly-time-slot">
                  <input type="time" class="tracking-input weekly-time-picker" value="12:00" />
                  <button type="button" class="weekly-time-remove" title="Remove">&times;</button>
                </div>
              </div>
              <button type="button" class="small-btn weekly-time-add" id="modalTaskAddTime">+ Add</button>
            </div>
          </div>
        </div>
        <div class="add-task-modal-row">
          <div class="signal-filter signal-filter--flush" id="modalTaskSignals">
            <span class="signal-filter-label">Signals:</span>
            <label class="signal-checkbox active"><input type="checkbox" value="email" checked /><span class="signal-icon">\u2709\ufe0f</span><span class="signal-label">Email</span></label>
            <label class="signal-checkbox active"><input type="checkbox" value="chat" checked /><span class="signal-icon">\uD83D\uDCAC</span><span class="signal-label">Chat</span></label>
            <label class="signal-checkbox active"><input type="checkbox" value="meeting" checked /><span class="signal-icon">\uD83D\uDCC5</span><span class="signal-label">Meetings</span></label>
            <label class="signal-checkbox active"><input type="checkbox" value="doc" checked /><span class="signal-icon">\uD83D\uDCC4</span><span class="signal-label">Documents</span></label>
          </div>
        </div>
        <div class="add-task-modal-row">
          <div class="add-task-field add-task-field-grow">
            <label class="add-task-label" for="modalTaskContext">Monitoring Context</label>
            <textarea id="modalTaskContext" class="tracking-textarea" placeholder="What should WorkIQ look for when refreshing this task?"></textarea>
          </div>
        </div>
        <div class="modal-actions">
          <button class="small-btn primary" id="modalTaskCreate">Create Task</button>
          <button class="small-btn" data-add-task-modal-close>Cancel</button>
        </div>
      </div>
    </div>
  `;

  // Bind schedule type toggle
  const typeSelect = modal.querySelector('#modalTaskScheduleType');
  if (typeSelect) {
    typeSelect.addEventListener('change', () => {
      const val = typeSelect.value;
      const intervalField = modal.querySelector('#modalTaskIntervalField');
      const oneTimeField = modal.querySelector('#modalTaskOneTimeField');
      const weeklyPanel = modal.querySelector('#modalTaskWeeklyPanel');
      if (intervalField) intervalField.classList.toggle('d-none', val !== 'interval');
      if (oneTimeField) oneTimeField.classList.toggle('d-none', val !== 'one-time');
      if (weeklyPanel) weeklyPanel.classList.toggle('d-none', val !== 'weekly');
    });
  }

  // Bind weekly day checkboxes
  const weeklyPanel = modal.querySelector('#modalTaskWeeklyPanel');
  if (weeklyPanel) {
    weeklyPanel.addEventListener('change', (event) => {
      const cb = event.target.closest('.modal-weekly-day-cb');
      if (cb) {
        const label = cb.closest('.weekly-day-label');
        if (label) label.classList.toggle('active', cb.checked);
        const anyChecked = weeklyPanel.querySelector('.modal-weekly-day-cb:checked');
        if (!anyChecked) { cb.checked = true; if (label) label.classList.add('active'); }
      }
    });
  }

  // Bind weekly time add/remove
  const addTimeBtn = modal.querySelector('#modalTaskAddTime');
  if (addTimeBtn) {
    addTimeBtn.addEventListener('click', () => {
      const slotsContainer = modal.querySelector('#modalTaskTimeSlots');
      if (!slotsContainer) return;
      const existing = [...slotsContainer.querySelectorAll('.weekly-time-picker')].map((inp) => inp.value).filter(Boolean);
      existing.push('09:00');
      slotsContainer.innerHTML = existing.map((t) => `
        <div class="weekly-time-slot">
          <input type="time" class="tracking-input weekly-time-picker" value="${escapeHtml(t)}" />
          ${existing.length > 1 ? '<button type="button" class="weekly-time-remove" title="Remove">&times;</button>' : ''}
        </div>
      `).join('');
    });
  }
  modal.addEventListener('click', (event) => {
    const removeBtn = event.target.closest('.weekly-time-remove');
    if (removeBtn) {
      const slot = removeBtn.closest('.weekly-time-slot');
      const slotsContainer = modal.querySelector('#modalTaskTimeSlots');
      if (!slot || !slotsContainer) return;
      const allSlots = [...slotsContainer.querySelectorAll('.weekly-time-slot')];
      if (allSlots.length <= 1) return;
      slot.remove();
    }
  });

  // Bind signal checkboxes
  const signalContainer = modal.querySelector('#modalTaskSignals');
  if (signalContainer) {
    signalContainer.addEventListener('change', (event) => {
      const cb = event.target.closest('input[type="checkbox"]');
      if (!cb) return;
      const label = cb.closest('.signal-checkbox');
      if (label) label.classList.toggle('active', cb.checked);
      const anyChecked = signalContainer.querySelector('input[type="checkbox"]:checked');
      if (!anyChecked) { cb.checked = true; if (label) label.classList.add('active'); }
    });
  }

  // Bind create button
  const createBtn = modal.querySelector('#modalTaskCreate');
  if (createBtn) {
    createBtn.addEventListener('click', () => {
      const selectedScannerId = modal.querySelector('#modalTaskScanner')?.value || null;
      const scheduleType = modal.querySelector('#modalTaskScheduleType')?.value || 'interval';

      let weeklyDays, weeklyTimes;
      if (scheduleType === 'weekly') {
        weeklyDays = [...modal.querySelectorAll('.modal-weekly-day-cb:checked')].map((cb) => cb.value).filter(Boolean);
        weeklyTimes = [...modal.querySelectorAll('#modalTaskTimeSlots .weekly-time-picker')].map((inp) => inp.value).filter(Boolean);
      }

      const signals = [...modal.querySelectorAll('#modalTaskSignals input[type="checkbox"]:checked')].map((cb) => cb.value).filter(Boolean);

      const trackingItem = createTrackingItemFromParams({
        title: modal.querySelector('#modalTaskTitle')?.value || '',
        context: modal.querySelector('#modalTaskContext')?.value || '',
        severity: modal.querySelector('#modalTaskSeverity')?.value || 'Observe',
        scheduleType,
        scheduleValue: modal.querySelector('#modalTaskScheduleValue')?.value || '30m',
        oneTimeAt: modal.querySelector('#modalTaskOneTimeAt')?.value || '',
        weeklyDays,
        weeklyTimes,
        signals,
        notifyEnabled: true,
        scannerId: selectedScannerId,
      });

      if (!trackingItem) return;

      closeAddTaskModal();
      renderRadarMode();
      highlightNewItem(trackingItem.id);
      showToast(`Task created: ${trackingItem.title}`, { icon: '\u2713' });
    });
  }

  // Bind close/cancel
  modal.querySelector('[data-add-task-modal-close]')?.addEventListener('click', closeAddTaskModal);

  // Close on backdrop click
  modal.addEventListener('click', (event) => {
    if (event.target === modal) closeAddTaskModal();
  });

  // Enter key submits
  const titleInput = modal.querySelector('#modalTaskTitle');
  if (titleInput) {
    titleInput.addEventListener('keydown', (event) => {
      if (event.key === 'Enter') {
        event.preventDefault();
        createBtn?.click();
      }
    });
  }

  modal.classList.add('show');

  // Focus the title input
  titleInput?.focus();
}

function closeAddTaskModal() {
  const modal = document.getElementById('addTaskModal');
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
  applyTimelineDelays(newEl);

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
