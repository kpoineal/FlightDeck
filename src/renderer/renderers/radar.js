// ── Unified rendering — all items in one pane ────────────────────────

// ── UI state helpers ─────────────────────────────────────────────────
function captureRadarUiState() {
  const container = elements.radarList;
  // Capture tracker row expansion state
  const expandedRowId = container.querySelector('.tracker-row-detail.show')?.parentElement?.getAttribute('data-tracker-id') || null;

  // Capture section panel states (people, links, monitoring, history, prompt)
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

  if (saved.sectionStates) {
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
      return items.filter((item) => item.archived);
    default: // 'all'
      return items.filter((item) => !item.archived);
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
  for (const [groupKey, items] of groups) {
    const scanner = groupKey !== '__radar__'
      ? state.scanners.find((s) => s.id === groupKey)
      : null;
    const groupName = scanner ? scanner.name : 'Radar';
    const isCollapsed = state.collapsedSections.includes(groupKey);

    html.push(`<div class="scanner-group" data-group-id="${escapeHtml(groupKey)}">`);
    html.push(`<div class="scanner-group-header" data-collapse-group-id="${escapeHtml(groupKey)}">`);
    html.push(`<span class="scanner-group-chevron ${isCollapsed ? '' : 'open'}">&#9660;</span>`);
    html.push(`<span class="scanner-group-name">${escapeHtml(groupName)}</span>`);
    html.push(`<span class="scanner-group-count">${items.length}</span>`);
    if (scanner) {
      html.push(`<button class="small-btn scanner-pause-btn" data-scanner-toggle-id="${escapeHtml(scanner.id)}" title="${scanner.enabled !== false ? 'Pause scanner' : 'Resume scanner'}">${scanner.enabled !== false ? '\u23f8' : '\u25b6'}</button>`);
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

function renderRadarMode() {
  renderRadarList();
  renderKpis();
}
