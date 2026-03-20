// ── Shared event handlers (used by both events.js and popout.js) ─────
// Each handler accepts a `container` element (the event delegation root)
// and an optional `renderFn` callback for re-rendering (e.g. renderTrackingMode or renderPopoutMode).

function handleSectionToggleClick(container, toggleEl, attrName) {
  const itemId = toggleEl.getAttribute(`data-${attrName}-toggle-id`);
  const panel = container.querySelector(`[data-${attrName}-panel-id="${CSS.escape(itemId)}"]`);
  if (panel) {
    const isExpanded = panel.classList.toggle('show');
    toggleEl.classList.toggle('expanded', isExpanded);
    const chevron = toggleEl.querySelector('.chevron');
    if (chevron) chevron.classList.toggle('chevron--expanded', isExpanded);
  }
}

function handlePromptToggleClick(container, toggleEl) {
  const itemId = toggleEl.getAttribute('data-prompt-toggle-id');
  const panel = container.querySelector(`[data-prompt-panel-id="${CSS.escape(itemId)}"]`);
  if (panel) {
    const isExpanded = panel.classList.toggle('show');
    toggleEl.classList.toggle('expanded', isExpanded);
    const chevron = toggleEl.querySelector('.chevron');
    if (chevron) chevron.classList.toggle('chevron--expanded', isExpanded);
    if (isExpanded) {
      const textarea = panel.querySelector('textarea');
      if (textarea) autoResizeTextarea(textarea);
    }
  }
}

async function handleMarkSeenClick(itemId, renderFn) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (item) {
    item.hasNewUpdate = false;
    if (Array.isArray(item.updateHistory)) {
      item.updateHistory.forEach((e) => { e.seen = true; });
    }
    await savePersistentState();
    if (renderFn) renderFn();
  }
}

async function handleRunNowClick(itemId, button, renderFn, showStatus) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (!item) return;

  setDraftButtonLoading(button, true);
  if (showStatus) setStatus('Running monitor check...');
  try {
    await monitorTaskItem(item, { manual: true });
    if (showStatus) {
      setStatus('Monitor check complete');
      setUpdatedNow();
    }
    if (renderFn) renderFn();
  } catch (error) {
    if (showStatus) {
      addHistory('failure', `Manual monitor failed for ${item.title}: ${error.message}`, { itemId });
      setStatus('Monitor check failed');
    }
    alert(`Unable to run monitor check:\n${error.message}`);
  } finally {
    setDraftButtonLoading(button, false);
  }
}

function handleAddTimeClick(itemId, container) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (!item) return;
  const newTimes = [...(item.weeklyTimes || DEFAULT_WEEKLY_TIMES), '09:00'];
  updateTrackingSchedule(itemId, 'weekly', item.scheduleValue, item.oneTimeAt, { weeklyTimes: newTimes, skipRender: true });
  const slotsContainer = container.querySelector(`[data-time-slots-id="${CSS.escape(itemId)}"]`);
  if (slotsContainer) slotsContainer.innerHTML = buildWeeklyTimeSlotsHtml(item.weeklyTimes, itemId);
  inlineUpdateScheduleControls(container, itemId, 'weekly');
}

function handleRemoveTimeClick(itemId, idx, container) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (!item) return;
  const current = [...(item.weeklyTimes || DEFAULT_WEEKLY_TIMES)];
  if (current.length <= 1) return;
  current.splice(idx, 1);
  updateTrackingSchedule(itemId, 'weekly', item.scheduleValue, item.oneTimeAt, { weeklyTimes: current, skipRender: true });
  const slotsContainer = container.querySelector(`[data-time-slots-id="${CSS.escape(itemId)}"]`);
  if (slotsContainer) slotsContainer.innerHTML = buildWeeklyTimeSlotsHtml(item.weeklyTimes, itemId);
  inlineUpdateScheduleControls(container, itemId, 'weekly');
}

function handleMonitorEnabledChange(itemId, checked, renderFn) {
  setTrackingEnabled(itemId, checked);
  if (renderFn) renderFn();
}

function handleNotifyToggleChange(itemId, checked) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (item) {
    item.notifyEnabled = checked;
    savePersistentState();
  }
}

function handleWorkHoursToggleChange(itemId, checked) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (!item) return;
  item.workHoursOnly = checked;
  savePersistentState();
}

function handleScheduleTypeSelectChange(itemId, container, value) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (!item) return;

  const intervalSelect = container.querySelector(`[data-monitor-interval-id="${CSS.escape(itemId)}"]`);
  const oneTimeInput = container.querySelector(`[data-monitor-onetime-id="${CSS.escape(itemId)}"]`);

  updateTrackingSchedule(
    itemId,
    value,
    intervalSelect?.value || item.scheduleValue,
    toIsoOrNull(oneTimeInput?.value) || item.oneTimeAt,
    { skipRender: true }
  );
  inlineUpdateScheduleControls(container, itemId, value);
}

function handleIntervalSelectChange(itemId, container, value) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (!item) return;
  updateTrackingSchedule(itemId, item.scheduleType, value, item.oneTimeAt, { skipRender: true });
  inlineUpdateScheduleControls(container, itemId, item.scheduleType);
}

function handleOneTimeInputChange(itemId, container, value) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (!item) return;
  const nextOneTimeAt = toIsoOrNull(value);
  updateTrackingSchedule(itemId, 'one-time', item.scheduleValue, nextOneTimeAt, { skipRender: true });
  inlineUpdateScheduleControls(container, itemId, 'one-time');
}

function handleWeeklyDayChange(itemId, container, cb) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (!item) return;

  const panel = container.querySelector(`[data-weekly-panel-id="${CSS.escape(itemId)}"]`);
  if (!panel) return;
  const days = [...panel.querySelectorAll('.weekly-day-cb:checked')].map((d) => d.value).filter(Boolean);
  if (!days.length) { cb.checked = true; return; }
  panel.querySelectorAll('.weekly-day-label').forEach((lbl) => {
    const checkbox = lbl.querySelector('.weekly-day-cb');
    lbl.classList.toggle('active', checkbox?.checked || false);
  });
  updateTrackingSchedule(itemId, 'weekly', item.scheduleValue, item.oneTimeAt, { weeklyDays: days, skipRender: true });
  inlineUpdateScheduleControls(container, itemId, 'weekly');
}

function handlePromptChangeEvent(itemId, value) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (!item) return;
  item.monitorPrompt = value || item.title || '';
  savePersistentState();
}

function handleSeveritySelectChange(itemId, value, renderFn) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (!item) return;
  item.severity = normalizeSeverity(value);
  savePersistentState();
  if (renderFn) renderFn();
}

function handleSignalCheckboxChange(itemId, container, signalCheckbox) {
  const item = state.trackingItems.find((entry) => entry.id === itemId);
  if (!item) return;

  const filterContainer = container.querySelector(`[data-signal-filter-id="${CSS.escape(itemId)}"]`);
  if (!filterContainer) return;

  const checked = [...filterContainer.querySelectorAll('input[data-signal-type]:checked')]
    .map((cb) => cb.getAttribute('data-signal-type'))
    .filter(Boolean);

  if (!checked.length) {
    signalCheckbox.checked = true;
    return;
  }

  item.monitorSignals = checked;
  savePersistentState();

  filterContainer.querySelectorAll('.signal-checkbox').forEach((label) => {
    const cb = label.querySelector('input[data-signal-type]');
    label.classList.toggle('active', cb?.checked || false);
  });
}

// ── Main window event binding ────────────────────────────────────────

function bindEvents() {
  document.addEventListener('click', async (event) => {
    const anchor = event.target.closest('a[href]');
    if (!anchor) return;

    const href = normalizeExternalUrl(anchor.getAttribute('href') || anchor.href);
    if (!href) return;

    event.preventDefault();
    const result = await window.workiq.openExternal(href);
    if (!result?.success) {
      console.warn('[flightdeck] failed to open external link', href, result?.error || 'unknown error');
      alert(`Unable to open link:\n${href}`);
    }
  });

  const themeToggle = document.getElementById('themeToggle');
  if (themeToggle) {
    themeToggle.addEventListener('click', toggleTheme);
  }

  elements.modeButtons.forEach((button) => {
    button.addEventListener('click', () => setMode(button.dataset.mode));
  });

  initSearch();

  elements.enableBtn.addEventListener('click', async () => {
    elements.enableBtn.disabled = true;
    console.group('%c[FlightDeck] Enable WorkIQ', 'color: #0a84ff; font-weight: bold');
    console.log('Step 1: Accepting EULA...');
    setStatus('Accepting EULA...');
    try {
      const eula = await window.workiq.acceptEula();
      if (eula.diagnostics) {
        console.log('EULA diagnostics:', eula.diagnostics);
        console.table({
          'WorkIQ mode': eula.diagnostics.workiqMode,
          'Launcher path': eula.diagnostics.workiqLauncher,
          'Launcher exists': eula.diagnostics.launcherExists,
          'Executable': eula.diagnostics.executable,
          'Args': (eula.diagnostics.args || []).join(' '),
          'Exit code': eula.diagnostics.exitCode,
          'Reason': eula.diagnostics.reason,
          'Output length': eula.diagnostics.rawOutputLength,
        });
        if (eula.diagnostics.cleanedOutput) {
          console.log('EULA output:', eula.diagnostics.cleanedOutput);
        }
        if (eula.diagnostics.dataChunks?.length) {
          console.log('Raw data chunks:', eula.diagnostics.dataChunks);
        }
      }
      if (!eula.success) {
        console.warn('accept-eula returned non-success:', eula.error);
      } else {
        console.log('%c✓ EULA accepted', 'color: #30d158');
      }
    } catch (eulaErr) {
      console.warn('accept-eula threw (continuing anyway):', eulaErr.message);
    }
    try {
      console.log('Step 2: Health check...');
      setStatus('Checking WorkIQ...');
      const health = await window.workiq.ask('Reply with JSON: {"status":"ok"}');
      if (!health.success) {
        throw new Error(health.error || 'WorkIQ check failed.');
      }
      state.connected = true;
      elements.connectBanner.classList.add('d-none');
      setStatus('Connected');
      console.log('%c✓ Connected to WorkIQ', 'color: #30d158; font-weight: bold');
      addHistory('connect', 'WorkIQ connectivity enabled');
      savePersistentState();
      await refreshAllData();
    } catch (error) {
      setStatus('Connect failed');
      console.error('Health check failed:', error.message);
      addHistory('failure', `WorkIQ connect failed: ${error.message}`);
      alert(`Unable to enable WorkIQ:\n${error.message}`);
    } finally {
      console.groupEnd();
      elements.enableBtn.disabled = false;
    }
  });

  elements.refreshBtn.addEventListener('click', refreshCurrentMode);

  // Add Task collapsible toggle
  const addTaskToggle = document.getElementById('addTaskToggle');
  const addTaskPanel = document.getElementById('addTaskPanel');
  if (addTaskToggle && addTaskPanel) {
    addTaskToggle.addEventListener('click', () => {
      const isExpanded = addTaskPanel.classList.toggle('show');
      addTaskToggle.classList.toggle('expanded', isExpanded);
    });
  }

  elements.customTaskScheduleType?.addEventListener('change', () => {
    updateCustomTaskScheduleInput();
  });

  const customWeeklyPanel = document.getElementById('customTaskWeeklyPanel');
  if (customWeeklyPanel) {
    customWeeklyPanel.addEventListener('change', (event) => {
      const cb = event.target.closest('.weekly-day-cb');
      if (cb) {
        const label = cb.closest('.weekly-day-label');
        if (label) label.classList.toggle('active', cb.checked);
        const anyChecked = customWeeklyPanel.querySelector('.weekly-day-cb:checked');
        if (!anyChecked) {
          cb.checked = true;
          if (label) label.classList.add('active');
        }
        return;
      }
    });

    customWeeklyPanel.addEventListener('click', (event) => {
      const addBtn = event.target.closest('#customTaskAddTime');
      if (addBtn) {
        const slotsContainer = document.getElementById('customTaskTimeSlots');
        if (!slotsContainer) return;
        const existing = [...slotsContainer.querySelectorAll('.weekly-time-picker')].map((inp) => inp.value).filter(Boolean);
        existing.push('09:00');
        slotsContainer.innerHTML = existing.map((t, i) => `
          <div class="weekly-time-slot">
            <input type="time" class="tracking-input weekly-time-picker" value="${escapeHtml(t)}" />
            ${existing.length > 1 ? '<button type="button" class="weekly-time-remove" title="Remove">&times;</button>' : ''}
          </div>
        `).join('');
        return;
      }
      const removeBtn = event.target.closest('.weekly-time-remove');
      if (removeBtn) {
        const slot = removeBtn.closest('.weekly-time-slot');
        const slotsContainer = document.getElementById('customTaskTimeSlots');
        if (!slot || !slotsContainer) return;
        const allSlots = [...slotsContainer.querySelectorAll('.weekly-time-slot')];
        if (allSlots.length <= 1) return;
        slot.remove();
        const remaining = [...slotsContainer.querySelectorAll('.weekly-time-picker')].map((inp) => inp.value).filter(Boolean);
        slotsContainer.innerHTML = remaining.map((t, i) => `
          <div class="weekly-time-slot">
            <input type="time" class="tracking-input weekly-time-picker" value="${escapeHtml(t)}" />
            ${remaining.length > 1 ? '<button type="button" class="weekly-time-remove" title="Remove">&times;</button>' : ''}
          </div>
        `).join('');
      }
    });
  }

  elements.createTaskBtn?.addEventListener('click', () => {
    createCustomTrackingItem();
  });

  const customSignalsContainer = document.getElementById('customTaskSignals');
  if (customSignalsContainer) {
    customSignalsContainer.addEventListener('change', (event) => {
      const cb = event.target.closest('input[type="checkbox"]');
      if (!cb) return;
      const label = cb.closest('.signal-checkbox');
      if (label) label.classList.toggle('active', cb.checked);
      const anyChecked = customSignalsContainer.querySelector('input[type="checkbox"]:checked');
      if (!anyChecked) {
        cb.checked = true;
        if (label) label.classList.add('active');
      }
    });
  }

  // Density toggle button (Tracking)
  const densityToggleBtn = document.getElementById('densityToggleBtn');
  if (densityToggleBtn) {
    densityToggleBtn.classList.toggle('is-minimal', state.trackingDensity === 'minimal');
    densityToggleBtn.title = state.trackingDensity === 'minimal' ? 'Switch to card view' : 'Switch to list view';
    densityToggleBtn.addEventListener('click', () => {
      state.trackingDensity = state.trackingDensity === 'minimal' ? 'full' : 'minimal';
      savePersistentState();
      renderTrackingMode();
    });
  }

  // Density toggle button (Radar)
  const radarDensityToggleBtn = document.getElementById('radarDensityToggleBtn');
  if (radarDensityToggleBtn) {
    radarDensityToggleBtn.classList.toggle('is-minimal', state.radarDensity === 'minimal');
    radarDensityToggleBtn.title = state.radarDensity === 'minimal' ? 'Switch to card view' : 'Switch to list view';
    radarDensityToggleBtn.addEventListener('click', () => {
      state.radarDensity = state.radarDensity === 'minimal' ? 'full' : 'minimal';
      savePersistentState();
      renderRadarMode();
    });
  }

  elements.commandInput.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      await handleCommandSubmit();
    }
  });

  elements.radarList.addEventListener('click', async (event) => {
    const dismissButton = event.target.closest('[data-dismiss-radar-id]');
    if (dismissButton) {
      event.preventDefault();
      const itemId = dismissButton.getAttribute('data-dismiss-radar-id');
      const dismissed = dismissRadarItem(itemId);
      if (!dismissed) return;

      addHistory('selection', `Deleted item: ${dismissed.title || itemId}`, { itemId });
      renderRadarMode();
      renderTrackingMode();
      return;
    }

    const trackButton = event.target.closest('[data-track-radar-id]');
    if (trackButton) {
      event.preventDefault();
      const itemId = trackButton.getAttribute('data-track-radar-id');
      const item = getInboundRadarItems().find((entry) => entry.id === itemId);
      if (!item) return;

      const alreadyTracked = state.trackingItems.some((entry) => entry.id === item.id);
      if (alreadyTracked) {
        removeTrackingItem(item.id);
        addHistory('selection', `Removed from Tracking: ${item.title}`, { itemId: item.id });
      } else {
        upsertTrackingItemFromRadar(item);
        addHistory('selection', `Added to Tracking: ${item.title}`, { itemId: item.id });
      }

      renderRadarMode();
      renderTrackingMode();
      return;
    }

    const suggestionButton = event.target.closest('[data-draft-suggestion]');
    if (suggestionButton) {
      event.preventDefault();
      await generateSuggestionDraft(
        suggestionButton.getAttribute('data-draft-suggestion'),
        suggestionButton.getAttribute('data-draft-item-id'),
        suggestionButton
      );
      return;
    }

    // Minimal row click → expand/collapse detail inline
    const radarRow = event.target.closest('[data-radar-row-toggle-id]');
    if (radarRow && !event.target.closest('select') && !event.target.closest('a[href]')) {
      const itemId = radarRow.getAttribute('data-radar-row-toggle-id');
      const wrapper = elements.radarList.querySelector(`.radar-row-wrapper[data-radar-id="${CSS.escape(itemId)}"]`);
      if (!wrapper) return;
      const detail = wrapper.querySelector('.radar-row-detail');
      const chevron = radarRow.querySelector('.row-expand-chevron');
      if (detail) {
        const currentlyOpen = elements.radarList.querySelector('.radar-row-detail.show');
        if (currentlyOpen && currentlyOpen !== detail) {
          currentlyOpen.classList.remove('show');
          const otherRow = currentlyOpen.parentElement.querySelector('.radar-row');
          if (otherRow) {
            otherRow.classList.remove('expanded');
            const otherChevron = otherRow.querySelector('.row-expand-chevron');
            if (otherChevron) otherChevron.classList.remove('open');
          }
        }
        const isExpanding = detail.classList.toggle('show');
        radarRow.classList.toggle('expanded', isExpanding);
        if (chevron) chevron.classList.toggle('open', isExpanding);
      }
      state.selectedRadarItemId = itemId;
      elements.radarList.querySelectorAll('.radar-row').forEach((r) => r.classList.remove('is-selected'));
      radarRow.classList.add('is-selected');
      return;
    }

    const radarCard = event.target.closest('[data-radar-id]');
    if (radarCard && !event.target.closest('a[href]') && !event.target.closest('[data-severity-select-id]')) {
      event.preventDefault();
      selectRadarItem(radarCard.getAttribute('data-radar-id'));
    }
  });

  elements.radarList.addEventListener('change', (event) => {
    const severitySelect = event.target.closest('[data-severity-select-id]');
    if (severitySelect) {
      const itemId = severitySelect.getAttribute('data-severity-select-id');
      const item = getInboundRadarItems().find((entry) => entry.id === itemId);
      if (!item) return;

      item.severity = normalizeSeverity(severitySelect.value);
      savePersistentState();
      renderRadarMode();
      return;
    }
  });

  elements.trackingList.addEventListener('click', async (event) => {
    const dismissButton = event.target.closest('[data-dismiss-radar-id]');
    if (dismissButton) {
      event.preventDefault();
      const itemId = dismissButton.getAttribute('data-dismiss-radar-id');
      const dismissed = dismissRadarItem(itemId);
      if (!dismissed) return;

      addHistory('selection', `Deleted item: ${dismissed.title || itemId}`, { itemId });
      renderTrackingMode();
      renderRadarMode();
      return;
    }

    const markSeenButton = event.target.closest('[data-mark-seen-id]');
    if (markSeenButton) {
      handleMarkSeenClick(markSeenButton.getAttribute('data-mark-seen-id'), renderTrackingMode);
      return;
    }

    const historyToggle = event.target.closest('[data-history-toggle-id]');
    if (historyToggle) {
      handleSectionToggleClick(elements.trackingList, historyToggle, 'history');
      return;
    }

    const peopleToggle = event.target.closest('[data-people-toggle-id]');
    if (peopleToggle) {
      handleSectionToggleClick(elements.trackingList, peopleToggle, 'people');
      return;
    }

    const linksToggle = event.target.closest('[data-links-toggle-id]');
    if (linksToggle) {
      handleSectionToggleClick(elements.trackingList, linksToggle, 'links');
      return;
    }

    // Minimal row click → expand/collapse detail inline
    const trackerRow = event.target.closest('[data-row-toggle-id]');
    if (trackerRow && !event.target.closest('select') && !event.target.closest('input') && !event.target.closest('label') && !event.target.closest('button') && !event.target.closest('.weekly-schedule-panel')) {
      const itemId = trackerRow.getAttribute('data-row-toggle-id');
      const wrapper = elements.trackingList.querySelector(`.tracker-row-wrapper[data-tracker-id="${CSS.escape(itemId)}"]`);
      if (!wrapper) return;
      const detail = wrapper.querySelector('.tracker-row-detail');
      const chevron = trackerRow.querySelector('.row-expand-chevron');
      if (detail) {
        const currentlyOpen = elements.trackingList.querySelector('.tracker-row-detail.show');
        if (currentlyOpen && currentlyOpen !== detail) {
          currentlyOpen.classList.remove('show');
          const otherRow = currentlyOpen.parentElement.querySelector('.tracker-row');
          if (otherRow) {
            otherRow.classList.remove('expanded');
            const otherChevron = otherRow.querySelector('.row-expand-chevron');
            if (otherChevron) otherChevron.classList.remove('open');
          }
        }
        const isExpanding = detail.classList.toggle('show');
        trackerRow.classList.toggle('expanded', isExpanding);
        if (chevron) chevron.classList.toggle('open', isExpanding);
      }
      return;
    }

    const monitoringToggle = event.target.closest('[data-monitoring-toggle-id]');
    if (monitoringToggle) {
      handleSectionToggleClick(elements.trackingList, monitoringToggle, 'monitoring');
      return;
    }

    const popoutButton = event.target.closest('[data-popout-id]');
    if (popoutButton) {
      const itemId = popoutButton.getAttribute('data-popout-id');
      const item = state.trackingItems.find((entry) => entry.id === itemId);
      if (item) {
        popOutTrackerCard(item);
      }
      return;
    }

    const promptToggle = event.target.closest('[data-prompt-toggle-id]');
    if (promptToggle) {
      handlePromptToggleClick(elements.trackingList, promptToggle);
      return;
    }

    const draftButton = event.target.closest('[data-draft-action-id]');
    if (draftButton) {
      await generateActionDraft(
        draftButton.getAttribute('data-draft-action-id'),
        draftButton.getAttribute('data-draft-item-id'),
        draftButton
      );
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
        renderTrackingMode,
        true
      );
      return;
    }

    const addTimeBtn = event.target.closest('[data-add-time-id]');
    if (addTimeBtn) {
      handleAddTimeClick(addTimeBtn.getAttribute('data-add-time-id'), elements.trackingList);
      return;
    }

    const removeTimeBtn = event.target.closest('[data-remove-time-id]');
    if (removeTimeBtn) {
      handleRemoveTimeClick(
        removeTimeBtn.getAttribute('data-remove-time-id'),
        parseInt(removeTimeBtn.getAttribute('data-time-index'), 10),
        elements.trackingList
      );
      return;
    }
  });

  elements.trackingList.addEventListener('change', (event) => {
    const enabledToggle = event.target.closest('[data-monitor-enabled-id]');
    if (enabledToggle) {
      handleMonitorEnabledChange(enabledToggle.getAttribute('data-monitor-enabled-id'), enabledToggle.checked);
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
      handleScheduleTypeSelectChange(typeSelect.getAttribute('data-monitor-type-id'), elements.trackingList, typeSelect.value);
      return;
    }

    const intervalSelect = event.target.closest('[data-monitor-interval-id]');
    if (intervalSelect) {
      handleIntervalSelectChange(intervalSelect.getAttribute('data-monitor-interval-id'), elements.trackingList, intervalSelect.value);
      return;
    }

    const oneTimeInput = event.target.closest('[data-monitor-onetime-id]');
    if (oneTimeInput) {
      handleOneTimeInputChange(oneTimeInput.getAttribute('data-monitor-onetime-id'), elements.trackingList, oneTimeInput.value);
      return;
    }

    const weeklyDayCb = event.target.closest('[data-weekly-day-id]');
    if (weeklyDayCb) {
      handleWeeklyDayChange(weeklyDayCb.getAttribute('data-weekly-day-id'), elements.trackingList, weeklyDayCb);
      return;
    }

    const weeklyTimePicker = event.target.closest('[data-weekly-time-id]');
    if (weeklyTimePicker) {
      collectAndUpdateWeeklyTimes(elements.trackingList, weeklyTimePicker.getAttribute('data-weekly-time-id'));
      return;
    }

    const promptInput = event.target.closest('[data-monitor-prompt-id]');
    if (promptInput) {
      handlePromptChangeEvent(promptInput.getAttribute('data-monitor-prompt-id'), promptInput.value);
    }

    const signalCheckbox = event.target.closest('[data-signal-item-id]');
    if (signalCheckbox) {
      handleSignalCheckboxChange(signalCheckbox.getAttribute('data-signal-item-id'), elements.trackingList, signalCheckbox);
      return;
    }

    const severitySelect = event.target.closest('[data-severity-select-id]');
    if (severitySelect) {
      handleSeveritySelectChange(severitySelect.getAttribute('data-severity-select-id'), severitySelect.value, renderTrackingMode);
      return;
    }
  });

  elements.trackingList.addEventListener('input', (event) => {
    const promptInput = event.target.closest('[data-monitor-prompt-id]');
    if (promptInput) {
      autoResizeTextarea(promptInput);
    }
  });

  // Inline editing for tracked items (title, dueAt, owner)
  elements.trackingList.addEventListener('click', (event) => {
    // Handle edit button clicks
    const editBtn = event.target.closest('[data-edit-field].edit-field-btn');
    if (editBtn) {
      const field = editBtn.getAttribute('data-edit-field');
      const itemId = editBtn.getAttribute('data-item-id');
      const span = elements.trackingList.querySelector(`[data-edit-field="${field}"][data-item-id="${CSS.escape(itemId)}"].editable-field`);
      if (span) {
        event.stopPropagation();
        activateInlineEdit(span, field, itemId);
      }
      return;
    }

    // Handle editable field clicks
    const editableField = event.target.closest('[data-edit-field].editable-field');
    if (editableField) {
      const field = editableField.getAttribute('data-edit-field');
      const itemId = editableField.getAttribute('data-item-id');
      event.stopPropagation();
      activateInlineEdit(editableField, field, itemId);
      return;
    }
  });

  function activateInlineEdit(span, field, itemId) {
    // Check if already editing
    if (span.contentEditable === 'true' || span.querySelector('input, .inline-edit')) return;

    const item = state.trackingItems.find((i) => i.id === itemId);
    if (!item) return;

    const originalValue = item[field] || '';
    const displayValue = span.textContent.trim();

    // Title uses contenteditable so it flows naturally with the text size
    if (field === 'title') {
      span.contentEditable = 'true';
      span.focus();
      const range = document.createRange();
      range.selectNodeContents(span);
      const sel = window.getSelection();
      sel.removeAllRanges();
      sel.addRange(range);

      let done = false;
      const doSave = () => {
        if (done) return;
        done = true;
        const newValue = span.textContent.trim();
        span.contentEditable = 'inherit';
        const result = updateTrackingItemField(itemId, 'title', newValue || originalValue);
        if (result) renderTrackingMode();
      };
      const doCancel = () => {
        if (done) return;
        done = true;
        span.contentEditable = 'inherit';
        renderTrackingMode();
      };

      span.addEventListener('blur', doSave, { once: true });
      span.addEventListener('keydown', function kd(e) {
        if (e.key === 'Enter') {
          e.preventDefault();
          span.removeEventListener('keydown', kd);
          doSave();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          span.removeEventListener('keydown', kd);
          span.removeEventListener('blur', doSave);
          doCancel();
        }
      });
      return;
    }

    let input;
    if (field === 'dueAt') {
      input = document.createElement('input');
      input.type = 'datetime-local';
      input.className = 'inline-edit inline-edit-date';
      // Convert ISO string to YYYY-MM-DDTHH:mm format for datetime-local
      if (originalValue) {
        const date = new Date(originalValue);
        if (!isNaN(date.getTime())) {
          const yyyy = date.getFullYear();
          const mm = String(date.getMonth() + 1).padStart(2, '0');
          const dd = String(date.getDate()).padStart(2, '0');
          const hh = String(date.getHours()).padStart(2, '0');
          const min = String(date.getMinutes()).padStart(2, '0');
          input.value = `${yyyy}-${mm}-${dd}T${hh}:${min}`;
        }
      }
    } else {
      input = document.createElement('input');
      input.type = 'text';
      input.className = 'inline-edit inline-edit-text';
      input.value = originalValue;
      if (field === 'title') {
        input.placeholder = 'Enter title';
      } else if (field === 'owner') {
        input.placeholder = 'Enter owner';
      }
    }

    const saveEdit = () => {
      const newValue = input.value.trim();
      
      // For datetime fields, convert to ISO string
      let valueToSave = newValue;
      if (field === 'dueAt' && newValue) {
        const date = new Date(newValue);
        if (!isNaN(date.getTime())) {
          valueToSave = date.toISOString();
        } else {
          valueToSave = null;
        }
      } else if (field === 'dueAt' && !newValue) {
        valueToSave = null;
      }

      // Update the model
      const result = updateTrackingItemField(itemId, field, valueToSave);
      if (result) {
        // Re-render the card/row
        renderTrackingMode();
      }
    };

    const cancelEdit = () => {
      // Restore original display
      renderTrackingMode();
    };

    // Replace span content with input
    span.innerHTML = '';
    span.appendChild(input);
    input.focus();
    if (input.type === 'text') {
      input.select();
    }

    // Save on blur
    input.addEventListener('blur', () => {
      saveEdit();
    });

    // Save on Enter, cancel on Escape
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        saveEdit();
      } else if (e.key === 'Escape') {
        e.preventDefault();
        cancelEdit();
      }
    });

    // For date input, save on change
    if (input.type === 'date') {
      input.addEventListener('change', () => {
        saveEdit();
      });
    }
  }

  elements.briefingPane.addEventListener('click', async (event) => {
    const dayBriefingButton = event.target.closest('[data-generate-day-briefing]');
    if (dayBriefingButton) {
      await generateDayBriefing(dayBriefingButton);
      return;
    }

    const generateButton = event.target.closest('[data-generate-briefing-id]');
    if (!generateButton) return;

    await generateBriefingForMeeting(generateButton.getAttribute('data-generate-briefing-id'), generateButton);
  });

  elements.briefingPane.addEventListener('toggle', (event) => {
    const details = event.target.closest('details[data-briefing-meeting-id]');
    if (!details) return;

    const meetingId = details.getAttribute('data-briefing-meeting-id');
    if (!meetingId) return;

    const set = new Set(state.expandedBriefingMeetingIds);
    if (details.open) {
      set.add(meetingId);
      markBriefingSeen(meetingId);
    } else {
      set.delete(meetingId);
    }
    state.expandedBriefingMeetingIds = [...set];
  });

  elements.confirmCancel.addEventListener('click', () => {
    addHistory('confirmation', 'User canceled confirmation');
    closeConfirmModal();
  });

  elements.confirmApply.addEventListener('click', () => {
    const action = state.pendingConfirmAction;
    if (!action) return;
    addHistory('confirmation', `User confirmed action: ${action.label}`, { actionId: action.id });
    closeConfirmModal();
    executeAction(action);
  });

  elements.confirmModal.addEventListener('click', (event) => {
    if (event.target === elements.confirmModal) {
      closeConfirmModal();
    }
  });

  window.workiq.onNotificationClicked?.((payload) => {
    const taskId = payload?.taskId;
    if (!taskId) return;

    const hasTask = state.trackingItems.some((entry) => entry.id === taskId);
    if (!hasTask) return;

    setMode('Tracking');
    state.expandedBriefingMeetingIds = state.expandedBriefingMeetingIds || [];
    renderTrackingMode();

    requestAnimationFrame(() => {
      const el = elements.trackingList.querySelector(`[data-tracker-id="${CSS.escape(taskId)}"]`);
      if (!el) return;

      if (state.trackingDensity === 'minimal') {
        const row = el.querySelector('[data-row-toggle-id]');
        const detail = el.querySelector('.tracker-row-detail');
        if (row && detail && !detail.classList.contains('show')) {
          const currentlyOpen = elements.trackingList.querySelector('.tracker-row-detail.show');
          if (currentlyOpen && currentlyOpen !== detail) {
            currentlyOpen.classList.remove('show');
            const otherRow = currentlyOpen.parentElement.querySelector('.tracker-row');
            if (otherRow) {
              otherRow.classList.remove('expanded');
              const otherChevron = otherRow.querySelector('.row-expand-chevron');
              if (otherChevron) otherChevron.classList.remove('open');
            }
          }
          detail.classList.add('show');
          row.classList.add('expanded');
          const chevron = row.querySelector('.row-expand-chevron');
          if (chevron) chevron.classList.add('open');
        }
      }

      el.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
    });
  });
}
