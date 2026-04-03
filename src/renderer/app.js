// ── App entry point — composition root (loaded last) ─────────────────

function addHistory(kind, summary, payload = {}) {
  // Trim oldest entries before insert to prevent unbounded growth between saves
  pruneHistory();
  state.history.unshift({
    id: `h_${Date.now()}_${Math.random().toString(16).slice(2, 7)}`,
    at: nowIso(),
    kind,
    summary,
    payload,
  });
  renderHistory();
}

function setStatus(text) {
  elements.dashboardStatus.textContent = text;
}

// ── In-app toast ─────────────────────────────────────────────────────
function showToast(message, { icon = '\u2713', durationMs = 3500 } = {}) {
  let container = document.querySelector('.toast-container');
  if (!container) {
    container = document.createElement('div');
    container.className = 'toast-container';
    document.body.appendChild(container);
  }
  const toast = document.createElement('div');
  toast.className = 'toast';
  toast.innerHTML = `<span class="toast-icon">${escapeHtml(icon)}</span><span class="toast-text">${escapeHtml(message)}</span>`;
  container.appendChild(toast);
  const dismiss = () => {
    toast.classList.add('toast--dismiss');
    toast.addEventListener('animationend', () => toast.remove(), { once: true });
  };
  setTimeout(dismiss, durationMs);
  toast.addEventListener('click', dismiss);
}

function setUpdatedNow() {
  elements.dashboardUpdatedAt.textContent = `Updated: ${new Date().toLocaleTimeString()}`;
}

function getSelectedTone() {
  return elements.toneSelect?.value || 'neutral';
}

function renderModeVisibility() {
  const viewMap = {
    Radar: elements.viewRadar,
    Briefings: elements.viewBriefings,
    History: elements.viewHistory,
  };

  for (const [mode, node] of Object.entries(viewMap)) {
    if (node) {
      node.classList.toggle('active', mode === state.mode);
    }
  }

  elements.modeButtons.forEach((button) => {
    button.classList.toggle('active', button.dataset.mode === state.mode);
  });


}

function renderAll() {
  renderKpis();
  renderModeVisibility();
  renderRadarMode();
  renderBriefingsMode();
  renderHistory();
}

async function refreshAllData() {
  if (!state.connected) {
    setStatus('Not connected');
    return;
  }

  state.loading = true;
  elements.refreshBtn.disabled = true;
  setStatus('Refreshing meetings...');

  try {
    const meetingsTask = runWorkiqJson(
      TODAY_MEETINGS_PROMPT,
      (payload) => payload && Array.isArray(payload.meetings),
      'meetings'
    )
      .then((payload) => {
        applyMeetingsPayload(payload);
        addHistory('scan', 'Meetings list refreshed');
        renderBriefingsMode();
      })
      .catch((error) => {
        addHistory('failure', `Meetings refresh failed: ${error.message}`);
        applyMeetingsPayload(buildFallbackMeetingPayload());
        renderBriefingsMode();
      });

    await meetingsTask;
    setStatus('Updated');
    setUpdatedNow();
  } catch (error) {
    setStatus('Refresh failed');
    addHistory('failure', `Refresh failed: ${error.message}`);
  } finally {
    state.loading = false;
    elements.refreshBtn.disabled = false;
  }
}

async function refreshRadarData() {
  if (!state.connected) {
    setStatus('Not connected');
    return;
  }

  const scanner = state.scanners.find(s => s.enabled);
  if (!scanner) {
    setStatus('No scanner configured');
    return;
  }

  state.loading = true;
  elements.refreshBtn.disabled = true;
  setStatus('Running radar scan...');

  try {
    await runScanner(scanner);
    setStatus('Updated');
    setUpdatedNow();
    renderAll();
  } catch (error) {
    addHistory('failure', `Radar scan issue: ${error.message}`);
    setStatus('Scan incomplete');
    elements.radarList.innerHTML = `<div class="empty">${escapeHtml(error.message)}</div>`;
  } finally {
    state.loading = false;
    elements.refreshBtn.disabled = false;
  }
}

async function refreshBriefingData() {
  if (!state.connected) {
    setStatus('Not connected');
    return;
  }

  state.loading = true;
  elements.refreshBtn.disabled = true;
  setStatus('Refreshing meetings...');

  try {
    const meetingsPayload = await runWorkiqJson(
      TODAY_MEETINGS_PROMPT,
      (payload) => payload && Array.isArray(payload.meetings),
      'meetings'
    );

    applyMeetingsPayload(meetingsPayload);
    addHistory('scan', 'Meetings list refreshed');
    setStatus('Updated');
    setUpdatedNow();
    renderAll();
  } catch (error) {
    addHistory('failure', `Meetings refresh failed: ${error.message}`);
    applyMeetingsPayload(buildFallbackMeetingPayload());
    setStatus('Partial update');
    setUpdatedNow();
    renderAll();
  } finally {
    state.loading = true;
    elements.refreshBtn.disabled = false;
  }
}

async function refreshCurrentMode() {
  // Demo mode: re-apply fixture data and re-render, no WorkIQ calls
  if (IS_DEMO) {
    applyDemoEphemeralState();
    setStatus('Demo Mode');
    setUpdatedNow();
    renderAll();
    return;
  }

  if (state.mode === 'Radar') {
    // Refresh button re-renders and refreshes meetings in background (no auto-scan)
    renderRadarMode();
    await refreshBriefingData();
    return;
  }

  if (state.mode === 'Briefings') {
    await refreshBriefingData();
    return;
  }

  if (state.mode === 'History') {
    setStatus('History up to date');
    setUpdatedNow();
    return;
  }

  await refreshAllData();
}

function setMode(mode) {
  if (mode === 'Tracking') mode = 'Radar';
  state.mode = mode;
  renderModeVisibility();
  renderKpis();

  if (mode === 'Radar') {
    renderRadarMode();
  }

  if (state.connected && mode === 'Briefings' && !state.meetings.length) {
    refreshBriefingData();
  }
}

function parseIntent(text) {
  const raw = String(text || '').trim().toLowerCase();
  if (!raw) return { intent: 'none' };

  if (raw.includes('refresh') || raw.includes('rescan')) return { intent: 'refresh' };
  if (raw.includes('radar')) return { intent: 'mode', mode: 'Radar' };
  if (raw.includes('tracking') || raw.includes('track')) return { intent: 'mode', mode: 'Tracking' };
  if (raw.includes('brief')) return { intent: 'mode', mode: 'Briefings' };
  if (raw.includes('runway') || raw.includes('ledger')) return { intent: 'mode', mode: 'Radar' };
  if (raw.includes('history') || raw.includes('audit')) return { intent: 'mode', mode: 'History' };
  if (raw.includes('draft')) return { intent: 'draft' };

  return { intent: 'unknown' };
}

async function handleCommandSubmit() {
  const text = elements.commandInput.value.trim();
  if (!text) return;

  const intent = parseIntent(text);
  addHistory('intent', `Command: ${text}`, intent);

  if (intent.intent === 'refresh') {
    await refreshCurrentMode();
  } else if (intent.intent === 'mode' && intent.mode) {
    setMode(intent.mode);
  } else if (intent.intent === 'draft') {
    const selected = getSelectedRadarItem();
    const tone = getSelectedTone();
    const message = selected
      ? `POC draft (${tone}) for: ${selected.title}`
      : `POC draft (${tone}): select a radar item first.`;
    addHistory('recommendation', message);
    alert(message);
  } else {
    alert('Command not recognized in POC. Try: refresh, open radar/briefings/history, draft reply.');
  }

  elements.commandInput.value = '';
}

async function init() {
  // Demo mode: load fixture and seed store before anything else
  if (IS_DEMO) {
    await loadDemoFixture();
    await seedDemoState();
  }

  if (IS_POPOUT) {
    await loadPromptFiles();
    await initPopoutMode();
    return;
  }

  if (!IS_DEMO) await loadPromptFiles();
  await loadPersistentState();
  updateStorageSize();
  bindEvents();
  if (!IS_DEMO) initPromptEditor();
  updateCustomTaskScheduleInput();

  // In demo mode: apply ephemeral state (radar, meetings, ledger) directly,
  // skip monitoring loop and all WorkIQ calls entirely.
  if (IS_DEMO) {
    applyDemoEphemeralState();
    renderAll();
    addHistory('startup', 'FlightDeck demo mode initialized');
    setStatus('Demo Mode');
    setUpdatedNow();
  } else {
    startMonitoringLoop();
    startScannerEngine();
    runDueMonitoringChecks();
    renderAll();
    addHistory('startup', 'FlightDeck cockpit initialized');
  }

  // Version badge — fire-and-forget before connection check so it shows immediately
  (async () => {
    try {
      const ver = await window.workiq.getAppVersion();
      const badge = document.getElementById('versionBadge');
      if (badge && ver) {
        badge.textContent = IS_DEMO ? `v${ver} · DEMO` : `v${ver}`;
        badge.classList.add('visible');
        if (IS_DEMO) badge.classList.add('demo');
      }
    } catch (_) { /* version display is non-critical */ }
  })();

  if (!IS_DEMO && state.connected) {
    setStatus('Verifying connection...');
    try {
      const health = await window.workiq.ask('Reply with JSON: {"status":"ok"}');
      if (!health.success) throw new Error(health.error || 'WorkIQ check failed.');
      setStatus('Connected');
      addHistory('connect', 'WorkIQ connection verified on startup');
      await refreshAllData();
    } catch (error) {
      state.connected = false;
      savePersistentState();
      if (elements.connectBanner) elements.connectBanner.classList.remove('d-none');
      setStatus('Connection lost');
      addHistory('failure', `Startup connection check failed: ${error.message}`);
      renderAll();
    }
  } else if (!IS_DEMO) {
    setStatus('Awaiting connection');
  }

  // Listen for state changes from popout windows
  window.workiq.onStateChanged(async () => {
    await loadPersistentState();
    renderRadarMode();
  });

}

init();
