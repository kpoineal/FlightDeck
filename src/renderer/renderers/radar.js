// ── Radar rendering — cards, rows, list, mode ────────────────────────

function buildRadarCard(item) {
  const selected = item.id === state.selectedRadarItemId;
  const tracked = state.trackingItems.some((entry) => entry.id === item.id);
  const people = item.counterparties.length ? item.counterparties.join(', ') : 'No counterparties listed';
  const allLinks = collectRadarSourceLinks(item);
  const sourcesHtml = allLinks.length
    ? allLinks.map((entry) => {
        const recency = signalRecencyLabel(entry.signalAt);
        return `<li><a href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">${escapeHtml(entry.label)}</a>${recency ? ` <span class="source-recency">(${escapeHtml(recency)})</span>` : ''}</li>`;
      }).join('')
    : '<li>No direct source links</li>';
  return `
    <article class="list-card radar-card ${selected ? 'is-selected' : ''}" data-radar-id="${escapeHtml(item.id)}">
      <div class="radar-head">
        <select class="severity-select ${severityClass(item.severity)}" data-severity-select-id="${escapeHtml(item.id)}">
          <option value="Critical" ${item.severity === 'Critical' ? 'selected' : ''}>Critical</option>
          <option value="Elevated" ${item.severity === 'Elevated' ? 'selected' : ''}>Elevated</option>
          <option value="Observe" ${item.severity === 'Observe' ? 'selected' : ''}>Observe</option>
        </select>
      </div>
      <div class="card-body">
        <h3 class="radar-title">${escapeHtml(item.title)}</h3>
        <p class="radar-summary">${escapeHtml(item.summary || item.reason || 'No summary provided.')}</p>
        ${buildNextStepHintsHtml(item, true)}
        <div class="meta">
          <span>Source: ${escapeHtml(item.sourceType)}</span>
          <span>Due: ${escapeHtml(safeDate(item.dueAt))}</span>
          <span>Owner: ${escapeHtml(item.owner)}</span>
        </div>
        <p class="radar-people"><strong>People:</strong> ${escapeHtml(people)}</p>
        <div class="radar-link"><strong>Links:</strong><ul class="source-list">${sourcesHtml}</ul></div>
        <div class="action-row">
          <button class="small-btn" data-track-radar-id="${escapeHtml(item.id)}">${tracked ? 'Remove from Tracking' : 'Track Item'}</button>
          <button class="small-btn warn" data-dismiss-radar-id="${escapeHtml(item.id)}">Delete</button>
        </div>
      </div>
    </article>
  `;
}

function getSelectedRadarItem() {
  return getInboundRadarItems().find((item) => item.id === state.selectedRadarItemId) || null;
}

// ── Radar UI state helpers ───────────────────────────────────────────
function captureRadarUiState() {
  const container = elements.radarList;
  const expandedRowId = container.querySelector('.radar-row-detail.show')?.parentElement?.getAttribute('data-radar-id') || null;
  const scrollTop = container.scrollTop;
  return { expandedRowId, scrollTop };
}

function restoreRadarUiState(saved) {
  const container = elements.radarList;
  if (!saved) return;
  if (saved.expandedRowId) {
    const wrapper = container.querySelector(`[data-radar-id="${CSS.escape(saved.expandedRowId)}"]`);
    if (wrapper) {
      const row = wrapper.querySelector('.radar-row');
      const detail = wrapper.querySelector('.radar-row-detail');
      if (row) row.classList.add('expanded');
      if (detail) detail.classList.add('show');
      const chevron = row?.querySelector('.row-expand-chevron');
      if (chevron) chevron.classList.add('open');
    }
  }
  if (saved.scrollTop) container.scrollTop = saved.scrollTop;
}

function buildRadarRow(item) {
  const selected = item.id === state.selectedRadarItemId;
  const tracked = state.trackingItems.some((entry) => entry.id === item.id);
  const people = item.counterparties.length ? item.counterparties.join(', ') : 'No counterparties listed';
  const allLinks = collectRadarSourceLinks(item);
  const sourcesHtml = allLinks.length
    ? allLinks.map((entry) => {
        const recency = signalRecencyLabel(entry.signalAt);
        return `<li><a href="${escapeHtml(entry.url)}" target="_blank" rel="noreferrer">${escapeHtml(entry.label)}</a>${recency ? ` <span class="source-recency">(${escapeHtml(recency)})</span>` : ''}</li>`;
      }).join('')
    : '<li>No direct source links</li>';

  return `
    <div class="radar-row-wrapper" data-radar-id="${escapeHtml(item.id)}">
      <div class="radar-row ${selected ? 'is-selected' : ''}" data-radar-row-toggle-id="${escapeHtml(item.id)}">
        <select class="severity-select ${severityClass(item.severity)}" data-severity-select-id="${escapeHtml(item.id)}">
          <option value="Critical" ${item.severity === 'Critical' ? 'selected' : ''}>Critical</option>
          <option value="Elevated" ${item.severity === 'Elevated' ? 'selected' : ''}>Elevated</option>
          <option value="Observe" ${item.severity === 'Observe' ? 'selected' : ''}>Observe</option>
        </select>
        <span class="radar-row-title">${escapeHtml(item.title)}</span>
        <span class="radar-row-summary">${escapeHtml((item.summary || item.reason || '').replace(/\n/g, ' ').slice(0, 140))}${(item.summary || item.reason || '').length > 140 ? '…' : ''}</span>
        <span class="radar-row-due">${escapeHtml(safeDate(item.dueAt))}</span>
        <span class="row-expand-chevron">&#9660;</span>
      </div>
      <div class="radar-row-detail">
        <p>${escapeHtml(item.summary || item.reason || 'No summary provided.')}</p>
        ${buildNextStepHintsHtml(item, true)}
        <div class="meta">
          <span>Source: ${escapeHtml(item.sourceType)}</span>
          <span>Due: ${escapeHtml(safeDate(item.dueAt))}</span>
          <span>Owner: ${escapeHtml(item.owner)}</span>
        </div>
        <p class="radar-people"><strong>People:</strong> ${escapeHtml(people)}</p>
        <div class="radar-link"><strong>Links:</strong><ul class="source-list">${sourcesHtml}</ul></div>
        <div class="action-row">
          <button class="small-btn" data-track-radar-id="${escapeHtml(item.id)}">${tracked ? 'Remove from Tracking' : 'Track Item'}</button>
          <button class="small-btn warn" data-dismiss-radar-id="${escapeHtml(item.id)}">Delete</button>
        </div>
      </div>
    </div>
  `;
}

function renderRadarList() {
  const inboundItems = getInboundRadarItems();
  if (!inboundItems.length) {
    elements.radarList.innerHTML = '<div class="empty">No inbound radar items yet. Click Refresh.</div>';
    return;
  }

  const hasSelected = inboundItems.some((item) => item.id === state.selectedRadarItemId);
  if (!hasSelected) {
    state.selectedRadarItemId = inboundItems[0].id;
  }

  // Sync density toggle icon state
  const radarDensityBtn = document.getElementById('radarDensityToggleBtn');
  if (radarDensityBtn) {
    radarDensityBtn.classList.toggle('is-minimal', state.radarDensity === 'minimal');
    radarDensityBtn.title = state.radarDensity === 'minimal' ? 'Switch to card view' : 'Switch to list view';
  }

  const isMinimal = state.radarDensity === 'minimal';
  elements.radarList.classList.toggle('list--minimal', isMinimal);

  if (isMinimal) {
    const savedUiState = captureRadarUiState();
    elements.radarList.innerHTML = inboundItems.map(buildRadarRow).join('');
    autoSizeSeveritySelects(elements.radarList);
    restoreRadarUiState(savedUiState);
    return;
  }

  elements.radarList.innerHTML = inboundItems.map(buildRadarCard).join('');
  autoSizeSeveritySelects(elements.radarList);
}

function renderRadarMode() {
  renderRadarList();
  renderKpis();
}

function selectRadarItem(id) {
  state.selectedRadarItemId = id;
  addHistory('selection', `Selected radar item ${id}`);
  renderRadarMode();
}
