// ── Scanner model logic ─────────────────────────────────────────────

function normalizeScannerDefinition(raw) {
  const id = String(raw?.id || '').trim() || `scanner_${hashString(`${Date.now()}_${Math.random()}`)}`;

  return {
    id,
    name: cleanDisplayText(raw?.name || 'Untitled Scanner'),
    prompt: typeof raw?.prompt === 'string' ? raw.prompt : DEFAULT_SCANNER_PROMPT,
    enabled: raw?.enabled !== false,
    isDefault: raw?.isDefault === true,
    scheduleType: raw?.scheduleType === 'one-time' ? 'one-time' : raw?.scheduleType === 'weekly' ? 'weekly' : 'interval',
    scheduleValue: SCHEDULE_INTERVAL_OPTIONS.some((entry) => entry.value === raw?.scheduleValue) ? raw.scheduleValue : '4h',
    oneTimeAt: raw?.oneTimeAt || null,
    weeklyDays: Array.isArray(raw?.weeklyDays) && raw.weeklyDays.length
      ? raw.weeklyDays.filter((d) => WEEKLY_DAY_OPTIONS.some((o) => o.value === d))
      : [...DEFAULT_WEEKLY_DAYS],
    weeklyTimes: Array.isArray(raw?.weeklyTimes) && raw.weeklyTimes.length
      ? raw.weeklyTimes.filter((t) => /^\d{2}:\d{2}$/.test(t))
      : [...DEFAULT_WEEKLY_TIMES],
    workHoursOnly: raw?.workHoursOnly === true,
    autoMonitorNewItems: raw?.autoMonitorNewItems === true,
    notificationMode: ['all', 'critical-only', 'silent'].includes(raw?.notificationMode) ? raw.notificationMode : 'all',
    signalTypes: Array.isArray(raw?.signalTypes) && raw.signalTypes.length
      ? raw.signalTypes.filter((s) => ALL_SIGNAL_TYPES.includes(s))
      : [...ALL_SIGNAL_TYPES],
    crossScannerDedup: raw?.crossScannerDedup !== false,
    autoMonitorSeverityThreshold: SEVERITY_THRESHOLD_OPTIONS.some((o) => o.value === raw?.autoMonitorSeverityThreshold) ? raw.autoMonitorSeverityThreshold : 'all',
    maxItemsPerScan: Number.isFinite(Number(raw?.maxItemsPerScan)) && Number(raw.maxItemsPerScan) >= 1 && Number(raw.maxItemsPerScan) <= 25 ? Number(raw.maxItemsPerScan) : 10,
    runOnStartup: raw?.runOnStartup === true,
    missedRunPolicy: MISSED_RUN_POLICY_OPTIONS.some((o) => o.value === raw?.missedRunPolicy) ? raw.missedRunPolicy : 'run-once',
    dedupStrategy: DEDUP_STRATEGY_OPTIONS.some((o) => o.value === raw?.dedupStrategy) ? raw.dedupStrategy : 'evidence-url',
    excludeKeywords: Array.isArray(raw?.excludeKeywords) ? raw.excludeKeywords.filter((v) => typeof v === 'string' && v.trim()) : [],
    defaultMonitorSchedule: SCHEDULE_INTERVAL_OPTIONS.some((o) => o.value === raw?.defaultMonitorSchedule) ? raw.defaultMonitorSchedule : '4h',
    defaultMonitorScheduleType: raw?.defaultMonitorScheduleType === 'one-time' ? 'one-time' : raw?.defaultMonitorScheduleType === 'weekly' ? 'weekly' : 'interval',
    defaultMonitorWorkHoursOnly: raw?.defaultMonitorWorkHoursOnly === true,
    defaultMonitorSignals: Array.isArray(raw?.defaultMonitorSignals) && raw.defaultMonitorSignals.length
      ? raw.defaultMonitorSignals.filter((s) => ALL_SIGNAL_TYPES.includes(s))
      : [...ALL_SIGNAL_TYPES],
    defaultMonitorNotifyEnabled: raw?.defaultMonitorNotifyEnabled !== false,
    defaultMonitorWeeklyDays: Array.isArray(raw?.defaultMonitorWeeklyDays) && raw.defaultMonitorWeeklyDays.length
      ? raw.defaultMonitorWeeklyDays.filter((d) => WEEKLY_DAY_OPTIONS.some((o) => o.value === d))
      : [...DEFAULT_WEEKLY_DAYS],
    defaultMonitorWeeklyTimes: Array.isArray(raw?.defaultMonitorWeeklyTimes) && raw.defaultMonitorWeeklyTimes.length
      ? raw.defaultMonitorWeeklyTimes.filter((t) => /^\d{2}:\d{2}$/.test(t))
      : [...DEFAULT_WEEKLY_TIMES],
    autoArchiveAfterDays: Number.isFinite(Number(raw?.autoArchiveAfterDays)) && Number(raw.autoArchiveAfterDays) >= 0 ? Number(raw.autoArchiveAfterDays) : 0,
    retentionDays: Number.isFinite(Number(raw?.retentionDays)) && Number(raw.retentionDays) >= 1 && Number(raw.retentionDays) <= 365 ? Number(raw.retentionDays) : 365,
    webhookUrl: typeof raw?.webhookUrl === 'string' && raw.webhookUrl.trim() ? raw.webhookUrl.trim() : '',
    scannerGroupId: typeof raw?.scannerGroupId === 'string' && raw.scannerGroupId.trim() ? raw.scannerGroupId.trim() : '',
    excludedItemIds: Array.isArray(raw?.excludedItemIds) ? raw.excludedItemIds.filter((v) => typeof v === 'string') : [],
    lastRunAt: raw?.lastRunAt || null,
    nextRunAt: raw?.nextRunAt || null,
    itemCount: Number(raw?.itemCount) || 0,
  };
}

function createScanner(name, prompt) {
  const scanner = normalizeScannerDefinition({
    id: `scanner_${hashString(`${Date.now()}_${Math.random()}`)}`,
    name,
    prompt: prompt || DEFAULT_SCANNER_PROMPT,
    enabled: true,
    isDefault: false,
  });
  scanner.nextRunAt = computeScannerNextRunAt(scanner);
  state.scanners.push(scanner);
  savePersistentState();
  return scanner;
}

function updateScanner(id, updates) {
  const scanner = state.scanners.find((s) => String(s.id) === String(id));
  if (!scanner) return null;

  const scheduleFields = ['scheduleType', 'scheduleValue', 'weeklyDays', 'weeklyTimes', 'oneTimeAt', 'workHoursOnly'];
  let scheduleChanged = false;

  for (const [key, value] of Object.entries(updates)) {
    if (key === 'id' || key === 'isDefault') continue; // immutable fields
    if (scheduleFields.includes(key)) scheduleChanged = true;
    scanner[key] = value;
  }

  // Re-normalize schedule fields after update
  const renormalized = normalizeScannerDefinition(scanner);
  Object.assign(scanner, renormalized);

  if (scheduleChanged) {
    scanner.nextRunAt = computeScannerNextRunAt(scanner);
  }

  savePersistentState();
  return scanner;
}

function deleteScanner(id) {
  const scanner = state.scanners.find((s) => String(s.id) === String(id));
  if (!scanner || scanner.isDefault) return false;

  state.scanners = state.scanners.filter((s) => String(s.id) !== String(id));

  const KEEP_STATUSES = new Set(['complete', 'archived']);
  const kept = [];
  for (const item of state.items) {
    if (String(item.scannerId) !== String(id)) { kept.push(item); continue; }
    if (KEEP_STATUSES.has(item.lifecycleStatus)) {
      item.scannerId = null;
      kept.push(item);
    }
    // active / in-progress / blocked / waiting / no status → discard
  }
  state.items = kept;
  state.radarItems = state.items;
  state.trackingItems = state.items;
  savePersistentState();
  return true;
}

function toggleScanner(id) {
  const scanner = state.scanners.find((s) => String(s.id) === String(id));
  if (!scanner) return null;

  scanner.enabled = !scanner.enabled;
  scanner.nextRunAt = scanner.enabled ? computeScannerNextRunAt(scanner) : null;
  savePersistentState();
  return scanner;
}

function addScannerExclusion(scannerId, itemId) {
  const scanner = state.scanners.find((s) => String(s.id) === String(scannerId));
  if (!scanner) return false;
  if (!scanner.excludedItemIds.includes(itemId)) {
    scanner.excludedItemIds.push(itemId);
    savePersistentState();
  }
  return true;
}

function getScannerById(id) {
  return state.scanners.find((s) => String(s.id) === String(id)) || null;
}

function getActiveScanners() {
  return state.scanners.filter((s) => s.enabled);
}

function ensureDefaultRadarScanner() {
  const existing = state.scanners.find((s) => s.isDefault === true || String(s.id) === RADAR_SCANNER_ID);
  if (existing) return existing;

  const scanner = normalizeScannerDefinition({
    id: RADAR_SCANNER_ID,
    name: 'Radar',
    prompt: promptCache.radarScan || '',
    enabled: true,
    isDefault: true,
    scheduleType: 'interval',
    scheduleValue: '4h',
  });
  scanner.nextRunAt = computeScannerNextRunAt(scanner);
  state.scanners.push(scanner);
  return scanner;
}

function getDefaultRadarScanner() {
  return state.scanners.find((s) => s.isDefault === true) || null;
}

function computeScannerNextRunAt(scanner, fromDate = new Date()) {
  if (!scanner?.enabled) return null;

  // Reuse computeNextRunAt from tracking.js — scanner uses the same schedule
  // shape. We create a thin adapter object with monitorEnabled set to true
  // so computeNextRunAt doesn't short-circuit.
  const adapter = {
    monitorEnabled: true,
    scheduleType: scanner.scheduleType,
    scheduleValue: scanner.scheduleValue,
    oneTimeAt: scanner.oneTimeAt,
    weeklyDays: scanner.weeklyDays,
    weeklyTimes: scanner.weeklyTimes,
    workHoursOnly: scanner.workHoursOnly === true,
  };
  return computeNextRunAt(adapter, fromDate);
}
