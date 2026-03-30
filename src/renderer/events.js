// ── Shared event handlers (used by both events.js and popout.js) ─────
// Each handler accepts a `container` element (the event delegation root)
// and an optional `renderFn` callback for re-rendering (e.g. renderTrackingMode or renderPopoutMode).

/**
 * Accordion helper: collapse all scanner sections except the given one.
 * Updates state.collapsedSections so only sectionId is expanded.
 */
function collapseAllSectionsExcept(sectionId) {
  const allSectionIds = [...elements.radarList.querySelectorAll('[data-section-items]')]
    .map((el) => el.getAttribute('data-section-items'))
    .filter(Boolean);
  state.collapsedSections = allSectionIds.filter((id) => id !== sectionId);
}

/**
 * Sync DOM collapsed state for all scanner sections to match state.collapsedSections.
 */
function syncCollapsedSectionsDOM() {
  elements.radarList.querySelectorAll('[data-section-items]').forEach((itemsContainer) => {
    const sectionId = itemsContainer.getAttribute('data-section-items');
    const shouldCollapse = state.collapsedSections.includes(sectionId);
    itemsContainer.classList.toggle('collapsed', shouldCollapse);
    const chevron = elements.radarList.querySelector(`[data-section-collapse="${CSS.escape(sectionId)}"]`);
    if (chevron) chevron.classList.toggle('collapsed', shouldCollapse);
  });
}

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
    item.isNew = false;
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

  // Unified density toggle
  const densityToggleBtn = document.getElementById('densityToggleBtn');
  if (densityToggleBtn) {
    densityToggleBtn.classList.toggle('is-minimal', state.density === 'minimal');
    densityToggleBtn.title = state.density === 'minimal' ? 'Switch to card view' : 'Switch to list view';
    densityToggleBtn.addEventListener('click', () => {
      state.density = state.density === 'minimal' ? 'full' : 'minimal';
      state.trackingDensity = state.density;
      state.radarDensity = state.density;
      savePersistentState();
      renderRadarMode();
    });
  }

  // Add Scanner button in heading row
  const addScannerBtn = document.getElementById('addScannerBtn');
  if (addScannerBtn) {
    addScannerBtn.addEventListener('click', () => {
      renderScannerSettingsModal(null);
    });
  }

  // Filter bar (outside radarList, needs its own listener)
  const filterBar = document.getElementById('filterBar');
  if (filterBar) {
    filterBar.addEventListener('click', (event) => {
      const filterBtn = event.target.closest('[data-filter]');
      if (!filterBtn) return;
      state.filter = filterBtn.dataset.filter || 'all';
      savePersistentState();
      renderRadarMode();
    });
  }

  elements.commandInput.addEventListener('keydown', async (event) => {
    if (event.key === 'Enter') {
      await handleCommandSubmit();
    }
  });

  // ── Scanner settings modal delegation ─────────────────────────────
  const scannerSettingsModal = document.getElementById('scannerSettingsModal');
  if (scannerSettingsModal) {
    // Toggle active class on signal type labels and weekly-day labels when checkboxes change
    scannerSettingsModal.addEventListener('change', (event) => {
      const signalCb = event.target.closest('.scanner-signal-cb');
      if (signalCb) {
        const label = signalCb.closest('.scanner-signal-label');
        if (label) label.classList.toggle('active', signalCb.checked);
        return;
      }
      const dayCb = event.target.closest('.weekly-day-cb');
      if (dayCb) {
        const label = dayCb.closest('.weekly-day-label');
        if (label) label.classList.toggle('active', dayCb.checked);
        return;
      }
    });

    // Close on overlay click
    scannerSettingsModal.addEventListener('click', (event) => {
      if (event.target === scannerSettingsModal) {
        closeScannerSettingsModal();
        return;
      }

      const closeBtn = event.target.closest('[data-scanner-modal-close]');
      if (closeBtn) {
        closeScannerSettingsModal();
        return;
      }

      const saveBtn = event.target.closest('[data-scanner-save]');
      if (saveBtn) {
        const editId = saveBtn.getAttribute('data-scanner-save');
        const values = readScannerModalFormValues();
        if (!values || !values.name) {
          alert('Scanner name is required.');
          return;
        }
        if (editId) {
          const scanner = getScannerById(editId);
          // For default radar scanner, sync prompt with promptCache
          if (scanner && scanner.isDefault && values.prompt) {
            promptCache.radarScan = values.prompt;
            saveCustomPrompt('radarScan', values.prompt);
            if (elements.radarPromptEditor) elements.radarPromptEditor.value = values.prompt;
          }
          updateScanner(editId, values);
        } else {
          createScanner(values.name, values.prompt, values);
        }
        closeScannerSettingsModal();
        renderRadarMode();
        return;
      }

      const deleteBtn = event.target.closest('[data-scanner-modal-delete]');
      if (deleteBtn) {
        const id = deleteBtn.getAttribute('data-scanner-modal-delete');
        const scanner = getScannerById(id);
        if (scanner && scanner.isDefault) return; // Cannot delete default scanner
        const name = scanner ? scanner.name : id;
        if (!confirm(`Delete scanner "${name}"?`)) return;
        deleteScanner(id);
        closeScannerSettingsModal();
        renderRadarMode();
        return;
      }

      // Reset radar prompt to default (from file)
      const resetPromptBtn = event.target.closest('[data-radar-prompt-reset]');
      if (resetPromptBtn) {
        (async () => {
          clearCustomPrompt('radarScan');
          const result = await window.workiq.readPromptFile('radar-scan.md');
          if (result.success) {
            promptCache.radarScan = result.content.trim();
            if (elements.radarPromptEditor) elements.radarPromptEditor.value = promptCache.radarScan;
            // Update the textarea in the modal
            const promptInput = scannerSettingsModal.querySelector('[data-scanner-input="prompt"]');
            if (promptInput) promptInput.value = promptCache.radarScan;
          }
        })();
        return;
      }

      const runNowBtn = event.target.closest('[data-scanner-run-now]');
      if (runNowBtn) {
        const id = runNowBtn.getAttribute('data-scanner-run-now');
        const scanner = getScannerById(id);
        if (!scanner) return;
        setDraftButtonLoading(runNowBtn, true);
        (async () => {
          try {
            await runScanner(scanner);
            closeScannerSettingsModal();
          } catch (err) {
            alert(`Scanner run failed: ${err.message}`);
          } finally {
            setDraftButtonLoading(runNowBtn, false);
          }
        })();
        return;
      }

      const addTimeBtn = event.target.closest('[data-scanner-add-time]');
      if (addTimeBtn) {
        const slotsContainer = scannerSettingsModal.querySelector('[data-scanner-time-slots]');
        if (!slotsContainer) return;
        const existing = [...slotsContainer.querySelectorAll('[data-scanner-weekly-time]')].map((inp) => inp.value).filter(Boolean);
        existing.push('09:00');
        slotsContainer.innerHTML = existing.map((t) => `
          <div class="weekly-time-slot">
            <input type="time" class="tracking-input weekly-time-picker" data-scanner-weekly-time value="${escapeHtml(t)}" />
            ${existing.length > 1 ? '<button type="button" class="weekly-time-remove" data-scanner-remove-time title="Remove">&times;</button>' : ''}
          </div>
        `).join('');
        return;
      }

      const removeTimeBtn = event.target.closest('[data-scanner-remove-time]');
      if (removeTimeBtn) {
        const slot = removeTimeBtn.closest('.weekly-time-slot');
        const slotsContainer = scannerSettingsModal.querySelector('[data-scanner-time-slots]');
        if (!slot || !slotsContainer) return;
        const allSlots = [...slotsContainer.querySelectorAll('.weekly-time-slot')];
        if (allSlots.length <= 1) return;
        slot.remove();
        const remaining = [...slotsContainer.querySelectorAll('[data-scanner-weekly-time]')].map((inp) => inp.value).filter(Boolean);
        slotsContainer.innerHTML = remaining.map((t) => `
          <div class="weekly-time-slot">
            <input type="time" class="tracking-input weekly-time-picker" data-scanner-weekly-time value="${escapeHtml(t)}" />
            ${remaining.length > 1 ? '<button type="button" class="weekly-time-remove" data-scanner-remove-time title="Remove">&times;</button>' : ''}
          </div>
        `).join('');
        return;
      }

      // Monitor weekly time add/remove
      const monitorAddTimeBtn = event.target.closest('[data-scanner-monitor-add-time]');
      if (monitorAddTimeBtn) {
        const slotsContainer = scannerSettingsModal.querySelector('[data-scanner-monitor-time-slots]');
        if (!slotsContainer) return;
        const existing = [...slotsContainer.querySelectorAll('[data-scanner-monitor-weekly-time]')].map((inp) => inp.value).filter(Boolean);
        existing.push('09:00');
        slotsContainer.innerHTML = existing.map((t) => `
          <div class="weekly-time-slot">
            <input type="time" class="tracking-input weekly-time-picker" data-scanner-monitor-weekly-time value="${escapeHtml(t)}" />
            ${existing.length > 1 ? '<button type="button" class="weekly-time-remove" data-scanner-monitor-remove-time title="Remove">&times;</button>' : ''}
          </div>
        `).join('');
        return;
      }

      const monitorRemoveTimeBtn = event.target.closest('[data-scanner-monitor-remove-time]');
      if (monitorRemoveTimeBtn) {
        const slot = monitorRemoveTimeBtn.closest('.weekly-time-slot');
        const slotsContainer = scannerSettingsModal.querySelector('[data-scanner-monitor-time-slots]');
        if (!slot || !slotsContainer) return;
        const allSlots = [...slotsContainer.querySelectorAll('.weekly-time-slot')];
        if (allSlots.length <= 1) return;
        slot.remove();
        const remaining = [...slotsContainer.querySelectorAll('[data-scanner-monitor-weekly-time]')].map((inp) => inp.value).filter(Boolean);
        slotsContainer.innerHTML = remaining.map((t) => `
          <div class="weekly-time-slot">
            <input type="time" class="tracking-input weekly-time-picker" data-scanner-monitor-weekly-time value="${escapeHtml(t)}" />
            ${remaining.length > 1 ? '<button type="button" class="weekly-time-remove" data-scanner-monitor-remove-time title="Remove">&times;</button>' : ''}
          </div>
        `).join('');
        return;
      }
    });
  }

  elements.radarList.addEventListener('click', async (event) => {
    // ── Per-scanner add item button ──
    const addItemBtn = event.target.closest('[data-scanner-add-item]');
    if (addItemBtn) {
      event.stopPropagation();
      event.preventDefault();
      const id = addItemBtn.getAttribute('data-scanner-add-item');
      renderAddTaskModal(id);
      return;
    }

    // ── Section header actions (check FIRST, before card/row handlers) ──
    const headerSettings = event.target.closest('[data-scanner-header-settings]');
    if (headerSettings) {
      event.stopPropagation();
      event.preventDefault();
      const id = headerSettings.getAttribute('data-scanner-header-settings');
      renderScannerSettingsModal(id);
      return;
    }

    // ── Inline pill filter click (BEFORE collapse handlers) ──
    const pillFilter = event.target.closest('[data-scanner-filter]');
    if (pillFilter) {
      event.stopPropagation();
      event.preventDefault();
      const filterAttr = pillFilter.getAttribute('data-scanner-filter');
      const sourceId = pillFilter.getAttribute('data-scanner-source-id');
      if (!filterAttr || !sourceId) return;

      // Parse filter type and value
      let type, value;
      if (filterAttr === 'new') {
        type = 'new'; value = 'new';
      } else {
        const parts = filterAttr.split(':');
        type = parts[0]; value = parts.slice(1).join(':');
      }

      // Toggle: clicking active pill clears, clicking different pill switches
      const current = state.scannerFilters[sourceId];
      if (current && current.type === type && current.value === value) {
        delete state.scannerFilters[sourceId];
      } else {
        state.scannerFilters[sourceId] = { type, value };
      }

      // If scanner is collapsed, we need a full render to expand it
      const colIdx = state.collapsedSections.indexOf(sourceId);
      if (colIdx >= 0) {
        state.collapsedSections.splice(colIdx, 1);
        savePersistentState();
        renderRadarMode();
      } else {
        // Scanner already expanded — just show/hide cards in place, no rebuild
        applyInlineFilterDOM(sourceId);
      }
      return;
    }

    // ── Clear inline filter button ──
    const filterClear = event.target.closest('[data-scanner-filter-clear]');
    if (filterClear) {
      event.stopPropagation();
      event.preventDefault();
      const sourceId = filterClear.getAttribute('data-scanner-filter-clear');
      if (sourceId) {
        delete state.scannerFilters[sourceId];
        applyInlineFilterDOM(sourceId);
      }
      return;
    }

    const collapseBtn = event.target.closest('[data-section-collapse]');
    if (collapseBtn) {
      event.stopPropagation();
      event.preventDefault();
      const sectionId = collapseBtn.getAttribute('data-section-collapse');
      delete state.scannerFilters[sectionId];
      const isCollapsed = state.collapsedSections.indexOf(sectionId) >= 0;
      if (isCollapsed) {
        // Expanding — collapse all others (accordion)
        collapseAllSectionsExcept(sectionId);
      } else {
        state.collapsedSections.push(sectionId);
      }
      collapseBtn.classList.toggle('collapsed');
      const itemsContainer = elements.radarList.querySelector(`[data-section-items="${CSS.escape(sectionId)}"]`);
      if (itemsContainer) itemsContainer.classList.toggle('collapsed');
      // Sync all other sections' DOM to match collapsed state
      syncCollapsedSectionsDOM();
      savePersistentState();
      return;
    }

    const headerToggle = event.target.closest('[data-scanner-header-toggle]');
    if (headerToggle) {
      event.stopPropagation();
      event.preventDefault();
      const id = headerToggle.getAttribute('data-scanner-header-toggle');
      toggleScanner(id);
      renderRadarMode();
      return;
    }

    // ── Clicking anywhere on the section header toggles collapse ──
    const sectionHeader = event.target.closest('.radar-section-header');
    if (sectionHeader) {
      event.stopPropagation();
      event.preventDefault();
      const sectionId = sectionHeader.getAttribute('data-source-id');
      if (sectionId) {
        const isCollapsed = state.collapsedSections.indexOf(sectionId) >= 0;
        if (isCollapsed) {
          // Expanding — collapse all others (accordion)
          collapseAllSectionsExcept(sectionId);
        } else {
          state.collapsedSections.push(sectionId);
          delete state.scannerFilters[sectionId];
        }
        const chevron = sectionHeader.querySelector('[data-section-collapse]');
        if (chevron) chevron.classList.toggle('collapsed');
        const itemsContainer = elements.radarList.querySelector(`[data-section-items="${CSS.escape(sectionId)}"]`);
        if (itemsContainer) itemsContainer.classList.toggle('collapsed');
        // Sync all other sections' DOM to match collapsed state
        syncCollapsedSectionsDOM();
        savePersistentState();
      }
      return;
    }

    // Create new scanner
    const createBtn = event.target.closest('[data-create-scanner-btn]');
    if (createBtn) {
      renderScannerSettingsModal(null);
      return;
    }

    // Filter bar
    const filterBtn = event.target.closest('[data-filter]');
    if (filterBtn && filterBtn.closest('.filter-bar')) {
      state.filter = filterBtn.dataset.filter || 'all';
      state.scannerFilters = {};
      savePersistentState();
      renderRadarMode();
      return;
    }

    // Card tab switching
    const cardTab = event.target.closest('[data-card-tab]');
    if (cardTab) {
      const itemId = cardTab.getAttribute('data-card-tab-item-id');
      const activeTab = cardTab.getAttribute('data-card-tab');
      const tabContainer = cardTab.closest('[data-card-tabs-id]');
      if (tabContainer) {
        tabContainer.querySelectorAll('.card-tab').forEach((t) => t.classList.toggle('active', t.getAttribute('data-card-tab') === activeTab));
        tabContainer.querySelectorAll('.card-tab-panel').forEach((p) => p.classList.toggle('active', p.getAttribute('data-card-tab-panel') === activeTab));
      }
      return;
    }

    const dismissButton = event.target.closest('[data-dismiss-radar-id]');
    if (dismissButton) {
      event.preventDefault();
      const itemId = dismissButton.getAttribute('data-dismiss-radar-id');
      const dismissed = dismissRadarItem(itemId);
      if (!dismissed) return;
      addHistory('selection', `Deleted item: ${dismissed.title || itemId}`, { itemId });
      renderRadarMode();
      return;
    }

    const markSeenButton = event.target.closest('[data-mark-seen-id]');
    if (markSeenButton) {
      const itemId = markSeenButton.getAttribute('data-mark-seen-id');
      handleMarkSeenClick(itemId, () => {
        // Update card/row in-place instead of full DOM rebuild
        const wrapper = elements.radarList.querySelector(`[data-tracker-id="${CSS.escape(itemId)}"]`);
        if (wrapper) {
          // Remove new-item visual states
          wrapper.classList.remove('has-new-update', 'is-new');
          wrapper.setAttribute('data-item-new', 'false');
          // Remove "New" badge
          const badge = wrapper.querySelector('.tracker-new-badge');
          if (badge) badge.remove();
          const badgePill = wrapper.querySelector('.badge-pill');
          if (badgePill) badgePill.remove();
          // Remove green glow outline
          const row = wrapper.querySelector('.tracker-row');
          if (row) row.classList.remove('has-new-update');
          // Remove "Updated" banner
          const updatedBanner = wrapper.querySelector('.tracker-updated-at');
          if (updatedBanner) updatedBanner.remove();
          // Remove unseen styling from timeline entries
          wrapper.querySelectorAll('.at-event--unseen').forEach((el) => el.classList.remove('at-event--unseen'));
          wrapper.querySelectorAll('.tracker-history-entry.unseen').forEach((el) => el.classList.remove('unseen'));
          // Hide the "Mark as Seen" button
          markSeenButton.style.display = 'none';
        }
        // Update the scanner header pill counts (new count changed)
        const section = wrapper?.closest('.radar-section');
        const sourceId = section?.querySelector('.radar-section-header')?.getAttribute('data-source-id');
        if (sourceId) {
          // Recount new items in this section
          const items = section.querySelectorAll('[data-item-new]');
          let newCount = 0;
          items.forEach((el) => { if (el.getAttribute('data-item-new') === 'true') newCount++; });
          const newIndicator = section.querySelector('.radar-new-indicator');
          if (newIndicator) {
            if (newCount > 0) {
              newIndicator.textContent = newCount + ' new';
              newIndicator.title = newCount + ' new or updated — click to filter';
            } else {
              newIndicator.remove();
            }
          }
        }
      });
      return;
    }

    const historyToggle = event.target.closest('[data-history-toggle-id]');
    if (historyToggle) {
      handleSectionToggleClick(elements.radarList, historyToggle, 'history');
      return;
    }

    const peopleToggle = event.target.closest('[data-people-toggle-id]');
    if (peopleToggle) {
      handleSectionToggleClick(elements.radarList, peopleToggle, 'people');
      return;
    }

    const linksToggle = event.target.closest('[data-links-toggle-id]');
    if (linksToggle) {
      handleSectionToggleClick(elements.radarList, linksToggle, 'links');
      return;
    }

    const timelineToggle = event.target.closest('[data-timeline-toggle-id]');
    if (timelineToggle) {
      handleSectionToggleClick(elements.radarList, timelineToggle, 'timeline');
      return;
    }

    // Minimal row click → expand/collapse detail inline
    const trackerRow = event.target.closest('[data-row-toggle-id]');
    if (trackerRow && !event.target.closest('select') && !event.target.closest('input') && !event.target.closest('label') && !event.target.closest('button') && !event.target.closest('.weekly-schedule-panel')) {
      const itemId = trackerRow.getAttribute('data-row-toggle-id');
      const wrapper = elements.radarList.querySelector(`.tracker-row-wrapper[data-tracker-id="${CSS.escape(itemId)}"]`);
      if (!wrapper) return;
      const detail = wrapper.querySelector('.tracker-row-detail');
      const chevron = trackerRow.querySelector('.row-expand-chevron');
      if (detail) {
        const currentlyOpen = elements.radarList.querySelector('.tracker-row-detail.show');
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

    // "Show N older" button in activity timeline
    const showOlderBtn = event.target.closest('[data-at-show-older]');
    if (showOlderBtn) {
      const timeline = showOlderBtn.closest('.activity-timeline');
      const hidden = timeline?.querySelector('.at-hidden-events');
      if (hidden) {
        hidden.classList.remove('d-none');
        showOlderBtn.remove();
      }
      return;
    }

    const monitoringToggle = event.target.closest('[data-monitoring-toggle-id]');
    if (monitoringToggle) {
      handleSectionToggleClick(elements.radarList, monitoringToggle, 'monitoring');
      return;
    }

    const popoutButton = event.target.closest('[data-popout-id]');
    if (popoutButton) {
      const itemId = popoutButton.getAttribute('data-popout-id');
      const item = state.items.find((entry) => entry.id === itemId);
      if (item) popOutTrackerCard(item);
      return;
    }

    const promptToggle = event.target.closest('[data-prompt-toggle-id]');
    if (promptToggle) {
      handlePromptToggleClick(elements.radarList, promptToggle);
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
      event.preventDefault();
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
        renderRadarMode,
        true
      );
      return;
    }

    const addTimeBtn = event.target.closest('[data-add-time-id]');
    if (addTimeBtn) {
      handleAddTimeClick(addTimeBtn.getAttribute('data-add-time-id'), elements.radarList);
      return;
    }

    const removeTimeBtn = event.target.closest('[data-remove-time-id]');
    if (removeTimeBtn) {
      handleRemoveTimeClick(
        removeTimeBtn.getAttribute('data-remove-time-id'),
        parseInt(removeTimeBtn.getAttribute('data-time-index'), 10),
        elements.radarList
      );
      return;
    }
  });

  elements.radarList.addEventListener('change', (event) => {
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
      handleScheduleTypeSelectChange(typeSelect.getAttribute('data-monitor-type-id'), elements.radarList, typeSelect.value);
      return;
    }

    const intervalSelect = event.target.closest('[data-monitor-interval-id]');
    if (intervalSelect) {
      handleIntervalSelectChange(intervalSelect.getAttribute('data-monitor-interval-id'), elements.radarList, intervalSelect.value);
      return;
    }

    const oneTimeInput = event.target.closest('[data-monitor-onetime-id]');
    if (oneTimeInput) {
      handleOneTimeInputChange(oneTimeInput.getAttribute('data-monitor-onetime-id'), elements.radarList, oneTimeInput.value);
      return;
    }

    const weeklyDayCb = event.target.closest('[data-weekly-day-id]');
    if (weeklyDayCb) {
      handleWeeklyDayChange(weeklyDayCb.getAttribute('data-weekly-day-id'), elements.radarList, weeklyDayCb);
      return;
    }

    const weeklyTimePicker = event.target.closest('[data-weekly-time-id]');
    if (weeklyTimePicker) {
      collectAndUpdateWeeklyTimes(elements.radarList, weeklyTimePicker.getAttribute('data-weekly-time-id'));
      return;
    }

    const promptInput = event.target.closest('[data-monitor-prompt-id]');
    if (promptInput) {
      handlePromptChangeEvent(promptInput.getAttribute('data-monitor-prompt-id'), promptInput.value);
    }

    const signalCheckbox = event.target.closest('[data-signal-item-id]');
    if (signalCheckbox) {
      handleSignalCheckboxChange(signalCheckbox.getAttribute('data-signal-item-id'), elements.radarList, signalCheckbox);
      return;
    }

    const moveToScannerSelect = event.target.closest('[data-move-to-scanner-id]');
    if (moveToScannerSelect) {
      const itemId = moveToScannerSelect.getAttribute('data-move-to-scanner-id');
      const targetScannerId = moveToScannerSelect.value || null;
      moveItemToScanner(itemId, targetScannerId);
      renderRadarMode();
      return;
    }

    const severitySelect = event.target.closest('[data-severity-select-id]');
    if (severitySelect) {
      handleSeveritySelectChange(severitySelect.getAttribute('data-severity-select-id'), severitySelect.value, renderRadarMode);
      return;
    }

    const statusSelect = event.target.closest('[data-status-select-id]');
    if (statusSelect) {
      const itemId = statusSelect.getAttribute('data-status-select-id');
      setItemLifecycleStatus(itemId, statusSelect.value);
      return;
    }
  });

  elements.radarList.addEventListener('input', (event) => {
    const promptInput = event.target.closest('[data-monitor-prompt-id]');
    if (promptInput) {
      autoResizeTextarea(promptInput);
    }
  });

  // Inline editing for tracked items (title, dueAt, owner)
  elements.radarList.addEventListener('click', (event) => {
    // Handle edit button clicks
    const editBtn = event.target.closest('[data-edit-field].edit-field-btn');
    if (editBtn) {
      const field = editBtn.getAttribute('data-edit-field');
      const itemId = editBtn.getAttribute('data-item-id');
      const span = elements.radarList.querySelector(`[data-edit-field="${field}"][data-item-id="${CSS.escape(itemId)}"].editable-field`);
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

    const item = state.items.find((i) => i.id === itemId);
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
        if (result) renderRadarMode();
      };
      const doCancel = () => {
        if (done) return;
        done = true;
        span.contentEditable = 'inherit';
        renderRadarMode();
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
        renderRadarMode();
      }
    };

    const cancelEdit = () => {
      // Restore original display
      renderRadarMode();
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

    // Reset filter to 'all' so the target item is guaranteed to render
    state.filter = 'all';
    // Clear any per-scanner inline filters that might hide the item
    state.scannerFilters = {};

    setMode('Radar');
    state.expandedBriefingMeetingIds = state.expandedBriefingMeetingIds || [];
    renderRadarMode();

    requestAnimationFrame(() => {
      const el = elements.radarList.querySelector(`[data-tracker-id="${CSS.escape(taskId)}"]`);
      if (!el) return;

      // Expand parent scanner section if collapsed
      const sectionItems = el.closest('.radar-section-items');
      if (sectionItems && sectionItems.classList.contains('collapsed')) {
        const sectionId = sectionItems.getAttribute('data-section-items');
        if (sectionId) {
          sectionItems.classList.remove('collapsed');
          const idx = state.collapsedSections.indexOf(sectionId);
          if (idx >= 0) state.collapsedSections.splice(idx, 1);
          const chevron = elements.radarList.querySelector(`[data-section-collapse="${CSS.escape(sectionId)}"]`);
          if (chevron) chevron.classList.remove('collapsed');
          savePersistentState();
        }
      }

      if (state.trackingDensity === 'minimal') {
        const row = el.querySelector('[data-row-toggle-id]');
        const detail = el.querySelector('.tracker-row-detail');
        if (row && detail && !detail.classList.contains('show')) {
          const currentlyOpen = elements.radarList.querySelector('.tracker-row-detail.show');
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

      // Highlight the card so the user knows which one the notification refers to
      el.classList.add('just-created');
      setTimeout(() => {
        el.classList.add('glow-fade');
        setTimeout(() => {
          el.classList.remove('just-created', 'glow-fade');
        }, 1300);
      }, 1500);
    });
  });
}
