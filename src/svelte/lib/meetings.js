import { cleanDisplayText, hashString, normalizeExternalUrl } from './utils.js';

export function normalizeTodayMeetings(raw, now = Date.now()) {
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const end = new Date(start);
  end.setDate(end.getDate() + 1);
  return raw.map((item) => {
    const startAt = item.startAt || null;
    const startTime = startAt ? new Date(startAt).getTime() : Number.NaN;
    const title = cleanDisplayText(item.title || 'Untitled meeting');
    const organizer = cleanDisplayText(item.organizer || 'Unknown organizer');
    const seed = [title.toLowerCase(), organizer.toLowerCase(), String(startAt), String(item.endAt || '')].join('|');
    return {
      id: (typeof item.id === 'string' ? item.id.trim() : '') || `meeting_${hashString(seed)}`,
      title, startAt, endAt: item.endAt || null, organizer,
      joinUrl: normalizeExternalUrl(item.joinUrl || ''),
      summary: cleanDisplayText(item.summary || ''),
      startTime,
    };
  }).filter((item) => Number.isFinite(item.startTime) && item.startTime < end.getTime()
    && (item.startTime >= start.getTime() || Date.parse(item.endAt) > start.getTime()))
    .sort((a, b) => a.startTime - b.startTime);
}
