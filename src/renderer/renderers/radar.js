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

function groupItemsByScanner(items) {
  const groups = new Map();
  for (const item of items) {
    const key = item.scannerId || '__radar__';
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(item);
  }
  return groups;
}

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
  const groups = groupItemsByScanner(sorted);

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
  elements.radarList.classList.toggle('list--minimal', isMinimal);

  // Capture UI state before re-render
  const savedUiState = captureRadarUiState();

  const html = [];

  // "Create Scanner" button at the top
  html.push('<div class="scanner-create-row"><button class="small-btn primary" data-create-scanner-btn>+ New Scanner</button></div>');

  for (const [groupKey, items] of groups) {
    const scanner = groupKey !== '__radar__'
      ? state.scanners.find((s) => s.id === groupKey)
      : null;
    const groupName = scanner ? scanner.name : 'Radar';
    const isCollapsed = state.collapsedSections.includes(groupKey);
    const enabled = scanner ? scanner.enabled !== false : true;

    html.push(`<div class="scanner-group" data-group-id="${escapeHtml(groupKey)}">`);
    html.push(`<div class="scanner-group-header" data-collapse-group-id="${escapeHtml(groupKey)}">`);
    html.push(`<span class="scanner-group-chevron ${isCollapsed ? '' : 'open'}">&#9660;</span>`);
    html.push(`<span class="scanner-group-name">${escapeHtml(groupName)}</span>`);
    html.push(`<span class="scanner-group-count">${items.length}</span>`);
    if (scanner) {
      const nextRun = scanner.nextRunAt ? safeDate(scanner.nextRunAt) : 'Not scheduled';
      html.push(`<span class="scanner-group-schedule">${escapeHtml(nextRun)}</span>`);
      html.push(`<button class="icon-btn" data-scanner-header-toggle="${escapeHtml(String(scanner.id))}" title="${enabled ? 'Pause scanner' : 'Resume scanner'}">${enabled ? '\u23f8' : '\u25b6'}</button>`);
      html.push(`<button class="icon-btn" data-scanner-header-settings="${escapeHtml(String(scanner.id))}" title="Scanner settings">\u2699\ufe0f</button>`);
    }
    html.push('</div>');

    if (!isCollapsed) {
      html.push('<div class="scanner-group-items">');
      if (isMinimal) {
        html.push(items.map((item) => buildTrackingRow(item, savedUiState.expandedRowId)).join(''));
      } else {
        html.push(items.map((item) => buildTrackingCard(item)).join(''));
      }
      html.push('</div>');
    }
    html.push('</div>');
  }

  elements.radarList.innerHTML = html.join('');
  autoSizeSeveritySelects(elements.radarList);
  restoreRadarUiState(savedUiState);

  // Enforce schedule-control visibility
  filtered.forEach((item) => {
    inlineUpdateScheduleControls(elements.radarList, item.id, item.scheduleType);
  });
}

function renderScannerSettingsModal(scannerId) {
  const modal = document.getElementById('scannerSettingsModal');
  if (!modal) return;

  const scanner = scannerId ? getScannerById(scannerId) : null;
  const formHtml = buildScannerForm(scanner);
  const isEdit = scanner != null;

  modal.innerHTML = `
    <div class="modal-card">
      <div class="modal-header">
        <h3>${isEdit ? 'Scanner Settings' : 'Create Scanner'}</h3>
        <button class="modal-close-btn" data-scanner-modal-close>&times;</button>
      </div>
      ${formHtml}
      ${isEdit ? `
        <div class="modal-footer">
          <button class="small-btn" data-scanner-run-now="${escapeHtml(String(scanner.id))}">Run Now</button>
          <button class="small-btn warn" data-scanner-modal-delete="${escapeHtml(String(scanner.id))}">Delete Scanner</button>
        </div>` : ''}
    </div>`;

  modal.classList.add('open');
}

function closeScannerSettingsModal() {
  const modal = document.getElementById('scannerSettingsModal');
  if (modal) {
    modal.classList.remove('open');
    modal.innerHTML = '';
  }
}

function renderRadarMode() {
  renderRadarList();
  renderKpis();
}
