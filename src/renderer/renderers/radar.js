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
    case 'monitored':
      return items.filter((item) => item.monitorEnabled && !item.archived);
    case 'new':
      return items.filter((item) => (item.isNew || item.hasNewUpdate) && !item.archived);
    case 'dueToday': {
      const todayStart = new Date();
      todayStart.setHours(0, 0, 0, 0);
      const todayEnd = new Date(todayStart);
      todayEnd.setDate(todayEnd.getDate() + 1);
      return items.filter((item) => {
        if (item.archived) return false;
        if (!item.dueAt) return false;
        const due = new Date(item.dueAt).getTime();
        return Number.isFinite(due) && due >= todayStart.getTime() && due < todayEnd.getTime();
      });
    }
    case 'archived':
      return items.filter((item) => item.lifecycleStatus === 'complete' || item.lifecycleStatus === 'archived');
    default: // 'all'
      return items.filter((item) => item.lifecycleStatus !== 'complete' && item.lifecycleStatus !== 'archived');
  }
}

// ── Grouped sections (from scanner branch) ───────────────────────────
function groupItemsBySource(filteredItems) {
  const radarItems = filteredItems.filter((item) => !item.scannerId);

  const scannerGroups = new Map();
  const scanners = Array.isArray(state.scanners) ? state.scanners : [];
  for (const scanner of scanners) {
    scannerGroups.set(scanner.id, { scanner, items: [] });
  }

  for (const item of filteredItems) {
    if (item.scannerId && scannerGroups.has(item.scannerId)) {
      scannerGroups.get(item.scannerId).items.push(item);
    }
  }

  const severityOrder = { Critical: 0, Elevated: 1, Observe: 2 };
  const sortedGroups = [...scannerGroups.values()].sort((a, b) => {
    const aEnabled = a.scanner.enabled !== false;
    const bEnabled = b.scanner.enabled !== false;
    if (aEnabled !== bEnabled) return aEnabled ? -1 : 1;
    const aMax = Math.min(...a.items.map((i) => severityOrder[i.severity] ?? 2), 2);
    const bMax = Math.min(...b.items.map((i) => severityOrder[i.severity] ?? 2), 2);
    return aMax - bMax;
  });

  return { radarItems, scannerGroups: sortedGroups };
}

// ── Section header (from scanner branch) ─────────────────────────────
function buildSectionHeader(sourceId, icon, name, count, { isScanner = false, scannerId = null, enabled = true } = {}) {
  const collapsed = Array.isArray(state.collapsedSections) && state.collapsedSections.includes(sourceId);
  return `
    <div class="radar-section-header ${enabled ? '' : 'disabled'}" data-source-id="${escapeHtml(sourceId)}">
      <div class="radar-section-header-left">
        <span class="radar-section-icon">${icon}</span>
        <span class="radar-section-name">${escapeHtml(name)}</span>
        <span class="radar-section-count">(${count})</span>
      </div>
      <div class="radar-section-header-actions">
        ${isScanner ? `
          <button class="icon-btn" data-scanner-header-toggle="${escapeHtml(String(scannerId))}" title="${enabled ? 'Pause scanner' : 'Resume scanner'}">${enabled ? '\u23f8' : '\u25b6'}</button>
          <button class="icon-btn" data-scanner-header-settings="${escapeHtml(String(scannerId))}" title="Scanner settings">\u2699\ufe0f</button>
        ` : `
          <button class="icon-btn" data-radar-prompt-settings title="Radar settings">\u2699\ufe0f</button>
        `}
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

  const { radarItems, scannerGroups } = groupItemsBySource(sorted);

  let html = '';

  // Main Radar section
  const radarCollapsed = Array.isArray(state.collapsedSections) && state.collapsedSections.includes('radar');
  html += `<div class="radar-section">`;
  html += buildSectionHeader('radar', '\uD83D\uDCE1', 'Radar', radarItems.length, { isScanner: false });
  html += `<div class="radar-section-items ${isMinimal ? 'list--minimal' : ''} ${radarCollapsed ? 'collapsed' : ''}" data-section-items="radar">`;
  html += radarItems.length
    ? radarItems.map((item) => isMinimal ? buildTrackingRow(item, savedUiState.expandedRowId) : buildTrackingCard(item)).join('')
    : '<div class="empty">No main radar items.</div>';
  html += `</div></div>`;

  // Scanner sections
  for (const group of scannerGroups) {
    const scanner = group.scanner;
    const sourceId = `scanner-${scanner.id}`;
    const enabled = scanner.enabled !== false;
    const collapsed = Array.isArray(state.collapsedSections) && state.collapsedSections.includes(sourceId);

    html += `<div class="radar-section ${enabled ? '' : 'disabled'}">`;
    html += buildSectionHeader(sourceId, '\uD83D\uDD0D', scanner.name || 'Unnamed Scanner', group.items.length, {
      isScanner: true,
      scannerId: scanner.id,
      enabled,
    });
    html += `<div class="radar-section-items ${isMinimal ? 'list--minimal' : ''} ${collapsed ? 'collapsed' : ''}" data-section-items="${escapeHtml(sourceId)}">`;
    html += group.items.length
      ? group.items.map((item) => isMinimal ? buildTrackingRow(item, savedUiState.expandedRowId) : buildTrackingCard(item)).join('')
      : '<div class="empty">No items from this scanner.</div>';
    html += `</div></div>`;
  }

  elements.radarList.innerHTML = html;
  autoSizeSeveritySelects(elements.radarList);
  restoreRadarUiState(savedUiState);

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
  const title = isEdit ? escapeHtml(scanner.name || 'Scanner Settings') : 'New Scanner';

  modal.innerHTML = `
    <div class="modal-card">
      <h3 class="scanner-modal-title">${title}</h3>
      ${buildScannerForm(scanner)}
      ${isEdit ? `<button class="scanner-modal-delete" data-scanner-modal-delete="${escapeHtml(String(scannerId))}">Delete this scanner</button>` : ''}
    </div>
  `;

  // Replace form save/cancel buttons to include Run Now for edit mode
  if (isEdit) {
    const actions = modal.querySelector('.scanner-form-actions');
    if (actions) {
      actions.innerHTML = `
        <button class="small-btn primary" data-scanner-save="${escapeHtml(String(scannerId))}">Update Scanner</button>
        <button class="small-btn" data-scanner-run-now="${escapeHtml(String(scannerId))}">Run Now</button>
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

  const values = {
    name: nameInput?.value?.trim() || '',
    prompt: promptInput?.value?.trim() || '',
    scheduleType: typeSelect?.value || 'interval',
    scheduleValue: valueSelect?.value || '4h',
  };

  if (values.scheduleType === 'weekly') {
    const dayCbs = form.querySelectorAll('[data-scanner-weekly-day]:checked');
    values.weeklyDays = [...dayCbs].map((cb) => cb.value).filter(Boolean);
    if (!values.weeklyDays.length) values.weeklyDays = [...DEFAULT_WEEKLY_DAYS];

    const timePickers = form.querySelectorAll('[data-scanner-weekly-time]');
    values.weeklyTimes = [...timePickers].map((inp) => inp.value).filter(Boolean);
    if (!values.weeklyTimes.length) values.weeklyTimes = [...DEFAULT_WEEKLY_TIMES];
  }

  return values;
}

// ── Radar prompt modal ───────────────────────────────────────────────
function renderRadarPromptModal() {
  const modal = document.getElementById('radarPromptModal');
  if (!modal) return;

  const currentPrompt = elements.radarPromptEditor ? elements.radarPromptEditor.value : '';

  modal.innerHTML = `
    <div class="modal-card" style="width:min(800px,100%)">
      <h3 class="scanner-modal-title">Radar Prompt</h3>
      <textarea id="radarPromptModalEditor" class="tracking-textarea" spellcheck="false" placeholder="Loading prompt..." style="min-height:400px;resize:vertical">${escapeHtml(currentPrompt)}</textarea>
      <div class="modal-actions">
        <button class="small-btn primary" id="radarPromptModalApply">Apply</button>
        <button class="small-btn" id="radarPromptModalReset">Reset to Default</button>
        <button class="small-btn" data-radar-prompt-modal-close>Cancel</button>
        <span class="prompt-status" id="radarPromptModalStatus"></span>
      </div>
    </div>
  `;

  modal.classList.add('show');
}

function closeRadarPromptModal() {
  const modal = document.getElementById('radarPromptModal');
  if (modal) {
    modal.classList.remove('show');
    modal.innerHTML = '';
  }
}

function renderRadarMode() {
  renderRadarList();
  renderKpis();
}
