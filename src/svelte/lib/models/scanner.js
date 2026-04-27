// ── Scanner model logic (ES module) ─────────────────────────────────
import {
  SCHEDULE_INTERVAL_OPTIONS,
  WEEKLY_DAY_OPTIONS,
  DEFAULT_WEEKLY_DAYS,
  DEFAULT_WEEKLY_TIMES,
  ALL_SIGNAL_TYPES,
  SEVERITY_THRESHOLD_OPTIONS,
  MISSED_RUN_POLICY_OPTIONS,
  DEDUP_STRATEGY_OPTIONS,
  DEFAULT_SCANNER_PROMPT,
} from '../constants.js';
import { hashString, cleanDisplayText } from '../utils.js';
import { computeNextRunAt } from './item.js';

export function normalizeScannerDefinition(raw) {
  const id = String(raw?.id || '').trim() || `scanner_${hashString(`${Date.now()}_${Math.random()}`)}`;

  return {
    id,
    name: cleanDisplayText(raw?.name || 'Untitled Scanner'),
    prompt: typeof raw?.prompt === 'string' ? raw.prompt : DEFAULT_SCANNER_PROMPT,
    enabled: raw?.enabled !== false,
    scheduleType: raw?.scheduleType === 'one-time' ? 'one-time' : raw?.scheduleType === 'weekly' ? 'weekly' : 'interval',
    scheduleValue: SCHEDULE_INTERVAL_OPTIONS.some((entry) => entry.value === raw?.scheduleValue) ? raw.scheduleValue : '2h',
    oneTimeAt: raw?.oneTimeAt || null,
    weeklyDays: Array.isArray(raw?.weeklyDays) && raw.weeklyDays.length
      ? raw.weeklyDays.filter((d) => WEEKLY_DAY_OPTIONS.some((o) => o.value === d))
      : [...DEFAULT_WEEKLY_DAYS],
    weeklyTimes: Array.isArray(raw?.weeklyTimes) && raw.weeklyTimes.length
      ? raw.weeklyTimes.filter((t) => /^\d{2}:\d{2}$/.test(t))
      : [...DEFAULT_WEEKLY_TIMES],
    workHoursOnly: raw?.workHoursOnly !== false,
    autoMonitorNewItems: raw?.autoMonitorNewItems !== false,
    notificationMode: ['all', 'critical-only', 'silent'].includes(raw?.notificationMode) ? raw.notificationMode : 'all',
    signalTypes: Array.isArray(raw?.signalTypes) && raw.signalTypes.length
      ? raw.signalTypes.filter((s) => ALL_SIGNAL_TYPES.includes(s))
      : [...ALL_SIGNAL_TYPES],
    crossScannerDedup: raw?.crossScannerDedup !== false,
    autoMonitorSeverityThreshold: SEVERITY_THRESHOLD_OPTIONS.some((o) => o.value === raw?.autoMonitorSeverityThreshold) ? raw.autoMonitorSeverityThreshold : 'all',
    maxItemsPerScan: Number.isFinite(Number(raw?.maxItemsPerScan)) && Number(raw.maxItemsPerScan) >= 1 && Number(raw.maxItemsPerScan) <= 25 ? Number(raw.maxItemsPerScan) : 10,
    missedRunPolicy: MISSED_RUN_POLICY_OPTIONS.some((o) => o.value === raw?.missedRunPolicy) ? raw.missedRunPolicy : 'skip',
    dedupStrategy: DEDUP_STRATEGY_OPTIONS.some((o) => o.value === raw?.dedupStrategy) ? raw.dedupStrategy : 'both',
    excludeKeywords: Array.isArray(raw?.excludeKeywords) ? raw.excludeKeywords.filter((v) => typeof v === 'string' && v.trim()) : [],
    defaultMonitorSchedule: SCHEDULE_INTERVAL_OPTIONS.some((o) => o.value === raw?.defaultMonitorSchedule) ? raw.defaultMonitorSchedule : '2h',
    defaultMonitorScheduleType: raw?.defaultMonitorScheduleType === 'one-time' ? 'one-time' : raw?.defaultMonitorScheduleType === 'weekly' ? 'weekly' : 'interval',
    defaultMonitorWorkHoursOnly: raw?.defaultMonitorWorkHoursOnly !== false,
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
    scannerGroupId: typeof raw?.scannerGroupId === 'string' && raw.scannerGroupId.trim() ? raw.scannerGroupId.trim() : '',
    excludedItemIds: Array.isArray(raw?.excludedItemIds) ? raw.excludedItemIds.filter((v) => typeof v === 'string') : [],
    lastRunAt: raw?.lastRunAt || null,
    nextRunAt: raw?.nextRunAt || null,
    itemCount: Number(raw?.itemCount) || 0,
    recentTitles: Array.isArray(raw?.recentTitles) ? raw.recentTitles.filter(
      (e) => e && typeof e.title === 'string' && typeof e.at === 'string'
    ) : [],
  };
}

export function computeScannerNextRunAt(scanner, fromDate = new Date()) {
  if (!scanner?.enabled) return null;
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
