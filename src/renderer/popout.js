// ── Popout Mode — single-item tracker window ─────────────────────────

const POPOUT_RESIZE_STORAGE_KEY = 'flightdeck_popout_panel_ratio';
const POPOUT_MIN_PANEL_PX = 250;

function applyPopoutPanelRatio() {
  const panels = document.querySelector('.popout-panels');
  if (!panels) return;
  // Inject drag handle if not present
  if (!panels.querySelector('.popout-resize-handle')) {
    const handle = document.createElement('div');
    handle.className = 'popout-resize-handle';
    handle.innerHTML = '<div class="popout-resize-grip"></div>';
    const rightPanel = panels.querySelector('.popout-panel-right');
    if (rightPanel) panels.insertBefore(handle, rightPanel);
  }
  const stored = localStorage.getItem(POPOUT_RESIZE_STORAGE_KEY);
  if (stored) {
    const ratio = parseFloat(stored);
    if (Number.isFinite(ratio) && ratio > 0 && ratio < 1) {
      panels.style.gridTemplateColumns = `${ratio}fr 6px ${1 - ratio}fr`;
    }
  }
}

function renderPopoutMode() {
  const item = state.trackingItems.find((entry) => entry.id === POPOUT_ITEM_ID);
  if (!item) {
    document.body.innerHTML = '<div class="popout-empty">This tracked item no longer exists.</div>';
    return;
  }

  document.title = item.title || 'Tracked Item';

  const historyEntries = Array.isArray(item.updateHistory) ? item.updateHistory : [];
  const hasNew = item.hasNewUpdate === true;
  const people = Array.isArray(item.counterparties) && item.counterparties.length
    ? item.counterparties.join(', ')
    : 'No counterparties listed';

  const unseenCount = unseenHistoryCount(item);
  const historyMarkup = buildTrackerHistoryMarkup(item);

  const popoutContainer = document.getElementById('popoutContainer');
  popoutContainer.innerHTML = `
    <article class="tracker-card tracker-card--popout ${hasNew ? 'has-new-update' : ''}" data-tracker-id="${escapeHtml(item.id)}">
      <div class="tracker-head">
        <select class="severity-select ${severityClass(item.severity)}" data-severity-select-id="${escapeHtml(item.id)}">
          <option value="Critical" ${item.severity === 'Critical' ? 'selected' : ''}>Critical</option>
          <option value="Elevated" ${item.severity === 'Elevated' ? 'selected' : ''}>Elevated</option>
          <option value="Observe" ${item.severity === 'Observe' ? 'selected' : ''}>Observe</option>
        </select>
        ${item.monitorEnabled !== false ? '<span class="pill automation-pill">Monitored</span>' : ''}
        ${(() => { if (hasNew) { return `<span class="tracker-new-badge">${unseenCount > 1 ? `${unseenCount} New Updates` : 'New Update'}</span>`; } const lastUpdate = item.lastChangedAt || item.lastRunAt || null; const rt = relativeTime(lastUpdate); return rt ? `<span class="pill last-updated-pill" title="Updated: ${escapeHtml(safeDate(lastUpdate))}">${escapeHtml(rt)}</span>` : ''; })()}
        <div class="popout-head-actions">
          ${unseenCount > 0 ? `<button class="small-btn primary" data-mark-seen-id="${escapeHtml(item.id)}">Mark as Seen</button>` : ''}
          <button class="small-btn warn" data-dismiss-radar-id="${escapeHtml(item.id)}">Delete</button>
        </div>
      </div>
      <div class="popout-panels">
        <div class="popout-panel-left">
          ${(() => { const lastUpdate = item.lastChangedAt || item.lastRunAt || null; const ts = lastUpdate ? new Date(lastUpdate) : null; const timeStr = ts && Number.isFinite(ts.getTime()) ? ts.toLocaleString() : null; const rt = relativeTime(lastUpdate); return hasNew && timeStr ? `<div class="tracker-updated-at">Updated: ${escapeHtml(timeStr)} (${escapeHtml(rt)})</div>` : ''; })()}
          <h3 class="tracker-title">${escapeHtml(item.title || 'Untitled item')}</h3>
          <p class="tracker-summary">${renderMarkdownLinks(item.summary || 'No summary available.')}</p>
          ${buildNextStepHintsHtml(item, true)}
          <div class="tracker-meta">
            <span>Source: ${escapeHtml(item.sourceType || 'Signal')}</span>
            <span>Due: ${escapeHtml(safeDate(item.dueAt))}</span>
            <span>Owner: ${escapeHtml(item.owner || 'You')}</span>
          </div>
          <div class="tracker-timestamp">
            Tracked: ${escapeHtml(safeDate(item.trackedAt, 'Unknown'))} · Last checked: ${escapeHtml(safeDate(item.lastRunAt, 'Never'))}
          </div>
          ${buildActivityTimelineHtml(item.updateHistory)}
          <button class="tracker-section-toggle expanded" data-people-toggle-id="${escapeHtml(item.id)}">
            <span class="chevron chevron--expanded">&#9654;</span> People (${(Array.isArray(item.counterparties) ? item.counterparties.length : 0)})
          </button>
          <div class="tracker-section-panel show" data-people-panel-id="${escapeHtml(item.id)}">
            <div class="people-chips">${Array.isArray(item.counterparties) && item.counterparties.length ? item.counterparties.map(p => `<span class="people-chip">${escapeHtml(p)}</span>`).join('') : `<span class="people-text">No counterparties listed</span>`}</div>
          </div>
          ${(() => {
            const links = Array.isArray(item.evidenceLinks) ? item.evidenceLinks.filter((e) => e && e.url) : [];
            if (!links.length) return '';
            const linksHtml = links.map((e) => {
              const recency = signalRecencyLabel(e.signalAt);
              return `<li>${escapeHtml(e.type || 'source')} &bull; <a href="${escapeHtml(e.url)}" target="_blank" rel="noreferrer">${escapeHtml(e.label || 'source')}</a>${recency ? ` <span class="source-recency">(${escapeHtml(recency)})</span>` : ''}</li>`;
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
            <span class="chevron">&#9654;</span> Monitoring${item.monitorEnabled !== false ? ` · <span class="popout-monitor-summary">${escapeHtml(item.scheduleType === 'weekly' ? 'Scheduled' : item.scheduleType === 'one-time' ? 'One-time' : 'Every ' + (item.scheduleValue || '30m'))} · ${(Array.isArray(item.monitorSignals) ? item.monitorSignals : ['Email','Chat','Meetings','Documents']).length} signals</span>` : ' · Disabled'}
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
        </div>
        <div class="popout-panel-right">
          <h4 class="popout-history-heading">Change History (${historyEntries.length})${unseenCount > 1 ? ` · <span class="history-unseen-count">${unseenCount} unseen</span>` : ''}</h4>
          <div class="popout-history-scroll">
            ${historyMarkup}
          </div>
        </div>
      </div>
    </article>
  `;

  autoSizeSeveritySelects(popoutContainer);
  // Enforce schedule-control visibility via DOM API — inline style attributes
  // from the HTML template are not reliably applied after innerHTML replacement.
  inlineUpdateScheduleControls(popoutContainer, item.id, item.scheduleType);
  applyPopoutPanelRatio();
}

async function initPopoutMode() {
  // Hide everything except popout content
  const topbar = document.querySelector('.topbar');
  const appShell = document.querySelector('.app-shell');
  if (topbar) topbar.classList.add('d-none');
  if (appShell) appShell.classList.add('d-none');

  // Create the popout container
  const container = document.createElement('div');
  container.id = 'popoutContainer';
  container.classList.add('popout-container');
  document.body.appendChild(container);

  await loadPersistentState();
  renderPopoutMode();

  // ── Resizable panels ──
  function initResize() {
    const panels = document.querySelector('.popout-panels');
    const handle = panels?.querySelector('.popout-resize-handle');
    if (!panels || !handle) return;

    let dragging = false;

    handle.addEventListener('mousedown', (e) => {
      e.preventDefault();
      dragging = true;
      document.body.style.cursor = 'col-resize';
      document.body.style.userSelect = 'none';
    });

    document.addEventListener('mousemove', (e) => {
      if (!dragging) return;
      requestAnimationFrame(() => {
        const rect = panels.getBoundingClientRect();
        const totalW = rect.width;
        let leftW = e.clientX - rect.left;
        leftW = Math.max(POPOUT_MIN_PANEL_PX, Math.min(leftW, totalW - POPOUT_MIN_PANEL_PX));
        const ratio = leftW / totalW;
        panels.style.gridTemplateColumns = `${ratio}fr 6px ${1 - ratio}fr`;
      });
    });

    document.addEventListener('mouseup', () => {
      if (!dragging) return;
      dragging = false;
      document.body.style.cursor = '';
      document.body.style.userSelect = '';
      // Persist ratio
      const cols = panels.style.gridTemplateColumns;
      const match = cols.match(/^([\d.]+)fr/);
      if (match) localStorage.setItem(POPOUT_RESIZE_STORAGE_KEY, match[1]);
    });
  }

  initResize();

  // Bind event delegation using shared handlers
  const popoutContainer = document.getElementById('popoutContainer');

  popoutContainer.addEventListener('click', async (event) => {
    const markSeenButton = event.target.closest('[data-mark-seen-id]');
    if (markSeenButton) {
      handleMarkSeenClick(markSeenButton.getAttribute('data-mark-seen-id'), renderPopoutMode);
      return;
    }

    const historyToggle = event.target.closest('[data-history-toggle-id]');
    if (historyToggle) {
      handleSectionToggleClick(popoutContainer, historyToggle, 'history');
      return;
    }

    const timelineToggle = event.target.closest('[data-timeline-toggle-id]');
    if (timelineToggle) {
      const panel = popoutContainer.querySelector('[data-timeline-panel-id="timeline"]');
      if (panel) {
        const isExpanded = timelineToggle.classList.toggle('expanded');
        panel.classList.toggle('show', isExpanded);
        const chevron = timelineToggle.querySelector('.chevron');
        if (chevron) chevron.classList.toggle('chevron--expanded', isExpanded);
      }
      return;
    }

    // Activity Timeline node/card click → scroll right panel to matching history entry
    const atEvent = event.target.closest('[data-at-index]');
    if (atEvent) {
      const idx = parseInt(atEvent.getAttribute('data-at-index'), 10);
      const historyScroll = popoutContainer.querySelector('.popout-history-scroll');
      if (historyScroll) {
        const entries = historyScroll.querySelectorAll('.tracker-history-entry');
        const target = entries[idx];
        if (target) {
          target.scrollIntoView({ behavior: 'smooth', block: 'center' });
          target.classList.add('at-pulse');
          setTimeout(() => target.classList.remove('at-pulse'), 1200);
        }
      }
      return;
    }

    const peopleToggle = event.target.closest('[data-people-toggle-id]');
    if (peopleToggle) {
      handleSectionToggleClick(popoutContainer, peopleToggle, 'people');
      return;
    }

    const linksToggle = event.target.closest('[data-links-toggle-id]');
    if (linksToggle) {
      handleSectionToggleClick(popoutContainer, linksToggle, 'links');
      return;
    }

    const monitoringToggle = event.target.closest('[data-monitoring-toggle-id]');
    if (monitoringToggle) {
      handleSectionToggleClick(popoutContainer, monitoringToggle, 'monitoring');
      return;
    }

    const promptToggle = event.target.closest('[data-prompt-toggle-id]');
    if (promptToggle) {
      handlePromptToggleClick(popoutContainer, promptToggle);
      return;
    }

    const dismissButton = event.target.closest('[data-dismiss-radar-id]');
    if (dismissButton) {
      const itemId = dismissButton.getAttribute('data-dismiss-radar-id');
      if (confirm('Delete this item permanently?')) {
        dismissRadarItem(itemId);
        renderPopoutMode();
      }
      return;
    }

    const suggestionButton = event.target.closest('[data-draft-suggestion]');
    if (suggestionButton) {
      await generateSuggestionDraft(
        suggestionButton.getAttribute('data-draft-suggestion'),
        suggestionButton.getAttribute('data-draft-item-id'),
        suggestionButton
      );
      return;
    }

    const runNowButton = event.target.closest('[data-monitor-run-now-id]');
    if (runNowButton) {
      await handleRunNowClick(
        runNowButton.getAttribute('data-monitor-run-now-id'),
        runNowButton,
        renderPopoutMode,
        false
      );
      return;
    }

    const addTimeBtn = event.target.closest('[data-add-time-id]');
    if (addTimeBtn) {
      handleAddTimeClick(addTimeBtn.getAttribute('data-add-time-id'), popoutContainer);
      return;
    }

    const removeTimeBtn = event.target.closest('[data-remove-time-id]');
    if (removeTimeBtn) {
      handleRemoveTimeClick(
        removeTimeBtn.getAttribute('data-remove-time-id'),
        parseInt(removeTimeBtn.getAttribute('data-time-index'), 10),
        popoutContainer
      );
      return;
    }
  });

  popoutContainer.addEventListener('change', (event) => {
    const enabledToggle = event.target.closest('[data-monitor-enabled-id]');
    if (enabledToggle) {
      handleMonitorEnabledChange(enabledToggle.getAttribute('data-monitor-enabled-id'), enabledToggle.checked, renderPopoutMode);
      return;
    }

    const notifyToggle = event.target.closest('[data-notify-enabled-id]');
    if (notifyToggle) {
      handleNotifyToggleChange(notifyToggle.getAttribute('data-notify-enabled-id'), notifyToggle.checked);
      return;
    }

    const workHoursToggle = event.target.closest('[data-work-hours-only-id]');
    if (workHoursToggle) {
      handleWorkHoursToggleChange(workHoursToggle.getAttribute('data-work-hours-only-id'), workHoursToggle.checked);
      return;
    }

    const typeSelect = event.target.closest('[data-monitor-type-id]');
    if (typeSelect) {
      handleScheduleTypeSelectChange(typeSelect.getAttribute('data-monitor-type-id'), popoutContainer, typeSelect.value);
      return;
    }

    const intervalSelect = event.target.closest('[data-monitor-interval-id]');
    if (intervalSelect) {
      handleIntervalSelectChange(intervalSelect.getAttribute('data-monitor-interval-id'), popoutContainer, intervalSelect.value);
      return;
    }

    const oneTimeInput = event.target.closest('[data-monitor-onetime-id]');
    if (oneTimeInput) {
      handleOneTimeInputChange(oneTimeInput.getAttribute('data-monitor-onetime-id'), popoutContainer, oneTimeInput.value);
      return;
    }

    const weeklyDayCb = event.target.closest('[data-weekly-day-id]');
    if (weeklyDayCb) {
      handleWeeklyDayChange(weeklyDayCb.getAttribute('data-weekly-day-id'), popoutContainer, weeklyDayCb);
      return;
    }

    const weeklyTimePicker = event.target.closest('[data-weekly-time-id]');
    if (weeklyTimePicker) {
      collectAndUpdateWeeklyTimes(popoutContainer, weeklyTimePicker.getAttribute('data-weekly-time-id'));
      return;
    }

    const promptInput = event.target.closest('[data-monitor-prompt-id]');
    if (promptInput) {
      handlePromptChangeEvent(promptInput.getAttribute('data-monitor-prompt-id'), promptInput.value);
    }

    const severitySelect = event.target.closest('[data-severity-select-id]');
    if (severitySelect) {
      handleSeveritySelectChange(severitySelect.getAttribute('data-severity-select-id'), severitySelect.value, renderPopoutMode);
      return;
    }

    const signalCheckbox = event.target.closest('[data-signal-item-id]');
    if (signalCheckbox) {
      handleSignalCheckboxChange(signalCheckbox.getAttribute('data-signal-item-id'), popoutContainer, signalCheckbox);
      return;
    }
  });

  popoutContainer.addEventListener('input', (event) => {
    const promptInput = event.target.closest('[data-monitor-prompt-id]');
    if (promptInput) {
      autoResizeTextarea(promptInput);
    }
  });

  // Listen for state changes from other windows
  window.workiq.onStateChanged(async () => {
    await loadPersistentState();
    renderPopoutMode();
  });
}
