import { get } from 'svelte/store';
import {
  connected, isDemo, meetings, meetingsLastFetched, items, kpis,
  briefingsByMeetingId, dayBriefingGenerating, dayBriefingError,
} from './stores.js';
import { getConnectionGeneration } from './connection.js';
import { DAY_BRIEFING_KEY } from './constants.js';
import { addHistory } from './actions.js';
import { savePersistentState } from './persistence.js';
import { cleanDisplayText, normalizeExternalUrl, nowIso } from './utils.js';
import { normalizeTodayMeetings } from './meetings.js';
import { TODAY_MEETINGS_PROMPT, buildDayBriefingPrompt } from './prompts.js';
import { runWorkiqJson } from './json-parser.js';

let meetingsRequest = null;
let lastAutomaticDay = '';

export async function refreshMeetings(force = false) {
  if (!get(connected) || get(isDemo) || typeof window.workiq?.ask !== 'function') return;
  const generation = getConnectionGeneration();
  const day = new Date().toDateString();
  if (meetingsRequest?.generation === generation && meetingsRequest.day === day) return meetingsRequest.promise;
  const lastFetch = get(meetingsLastFetched);
  if (!force && lastFetch && Date.now() - lastFetch < 3_600_000
    && new Date(lastFetch).toDateString() === new Date().toDateString()) {
    void generateDayBriefing({ automatic: true });
    return;
  }

  const request = (async () => {
    try {
      const payload = await runWorkiqJson(
        TODAY_MEETINGS_PROMPT, (p) => p && Array.isArray(p.meetings), 'meetings'
      );
      if (!get(connected) || generation !== getConnectionGeneration()
        || day !== new Date().toDateString()) return;
      const processed = normalizeTodayMeetings(payload.meetings);
      meetings.set(processed);
      meetingsLastFetched.set(Date.now());
      addHistory('scan', `Loaded ${processed.length} meeting(s) for today`);
      savePersistentState();
      void generateDayBriefing({ automatic: true });
    } catch (err) {
      addHistory('failure', `Meetings refresh failed: ${err.message}`);
      console.warn('[flightdeck] meetings fetch failed', err.message);
    } finally {
      if (meetingsRequest?.promise === request) meetingsRequest = null;
    }
  })();
  meetingsRequest = { generation, day, promise: request };
  return request;
}

export async function generateDayBriefing({ automatic = false } = {}) {
  if (!get(connected) || get(isDemo) || get(dayBriefingGenerating)
    || typeof window.workiq?.ask !== 'function') return;
  const day = new Date().toDateString();
  if (automatic) {
    const briefing = get(briefingsByMeetingId)[DAY_BRIEFING_KEY];
    if (new Date(briefing?.generatedAt).toDateString() === day || lastAutomaticDay === day) return;
  }
  // A failed automatic attempt stays manual-retryable without looping on focus/reconnect.
  lastAutomaticDay = day;
  const generation = getConnectionGeneration();
  dayBriefingGenerating.set(true);
  dayBriefingError.set('');
  addHistory('recommendation', 'Day briefing generation requested');
  try {
    let template = '';
    try {
      const result = await window.workiq.readPromptFile('day-briefing.md');
      if (!result.success || !result.content?.trim()) throw new Error(result.error || 'Empty prompt file');
      template = result.content.trim();
    } catch (err) {
      addHistory('failure', `Day briefing prompt could not be loaded; using built-in instructions: ${err.message}`);
    }
    if (!get(connected) || generation !== getConnectionGeneration()
      || day !== new Date().toDateString()) return;
    const prompt = buildDayBriefingPrompt(get(items), normalizeTodayMeetings(get(meetings)), get(kpis), template);
    const payload = await runWorkiqJson(
      prompt, (p) => p && typeof p.headline === 'string', 'day-briefing',
      { priority: automatic ? 'background' : 'interactive', key: `day-briefing:${day}` }
    );
    if (!get(connected) || generation !== getConnectionGeneration()
      || day !== new Date().toDateString()) return;
    const text = (value) => cleanDisplayText(value || '');
    const normalized = {
      headline: text(payload.headline || 'Your day at a glance'),
      topPriorities: Array.isArray(payload.topPriorities) ? payload.topPriorities.map(text) : [],
      meetingsRequiringPrep: Array.isArray(payload.meetingsRequiringPrep)
        ? payload.meetingsRequiringPrep.map((m) => ({
          title: text(m?.title || 'Meeting'), startAt: m?.startAt || null,
          whyPrepNeeded: text(m?.whyPrepNeeded || ''),
        })) : [],
      atRiskItems: Array.isArray(payload.atRiskItems) ? payload.atRiskItems.map((i) => ({
        title: text(i?.title || 'Item'), severity: text(i?.severity || 'Observe'), risk: text(i?.risk || ''),
      })) : [],
      suggestedTimeBlocks: Array.isArray(payload.suggestedTimeBlocks) ? payload.suggestedTimeBlocks.map((b) => ({
        time: text(b?.time || ''), activity: text(b?.activity || ''), rationale: text(b?.rationale || ''),
      })) : [],
      todayFollowUps: Array.isArray(payload.todayFollowUps) ? payload.todayFollowUps.map(text) : [],
      sources: Array.isArray(payload.sources) ? payload.sources.map((s) => ({
        label: text(s?.label || 'Source'), type: text(s?.type || 'source'),
        url: normalizeExternalUrl(s?.url || ''),
      })).filter((s) => s.url) : [],
      generatedAt: nowIso(),
    };
    briefingsByMeetingId.update((byId) => ({ ...byId, [DAY_BRIEFING_KEY]: normalized }));
    savePersistentState();
    addHistory('scan', 'Day briefing generated.');
  } catch (err) {
    const message = `Day briefing generation failed: ${err.message}`;
    dayBriefingError.set(message);
    addHistory('failure', message);
  } finally {
    dayBriefingGenerating.set(false);
  }
}
