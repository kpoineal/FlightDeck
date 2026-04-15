<script>
  import { meetings, briefingsByMeetingId, briefingSeenAt, expandedBriefingMeetingIds, items, kpis } from '../lib/stores.js';
  import { DAY_BRIEFING_KEY } from '../lib/constants.js';
  import { addHistory } from '../lib/actions.js';
  import { savePersistentState } from '../lib/persistence.js';
  import { nowIso, safeDate, cleanDisplayText, normalizeExternalUrl } from '../lib/utils.js';
  import DayBriefingCard from './DayBriefingCard.svelte';
  import MeetingCard from './MeetingCard.svelte';

  let dayGenerating = $state(false);
  let meetingGeneratingId = $state(null);

  let dayBriefing = $derived($briefingsByMeetingId[DAY_BRIEFING_KEY] || null);
  let dayBriefingUnseen = $derived(isDayBriefingUnseen(dayBriefing, $briefingSeenAt));

  function isDayBriefingUnseen(briefing, seenAt) {
    if (!briefing) return false;
    const seen = seenAt[DAY_BRIEFING_KEY];
    if (!seen) return true;
    return new Date(briefing.generatedAt).getTime() > new Date(seen).getTime();
  }

  function isMeetingBriefingUnseen(meetingId, briefing, seenAt) {
    if (!briefing) return false;
    const seen = seenAt[meetingId];
    if (!seen) return true;
    return new Date(briefing.generatedAt).getTime() > new Date(seen).getTime();
  }

  function getBriefing(meetingId) {
    return $briefingsByMeetingId[meetingId] || null;
  }

  let sortedMeetings = $derived(sortMeetings($meetings, $briefingsByMeetingId, $briefingSeenAt));

  function sortMeetings(mtgs, briefings, seenAt) {
    return [...mtgs].sort((a, b) => {
      const briefingA = briefings[a.id] || null;
      const briefingB = briefings[b.id] || null;
      const unseenA = isMeetingBriefingUnseen(a.id, briefingA, seenAt) ? 0 : 1;
      const unseenB = isMeetingBriefingUnseen(b.id, briefingB, seenAt) ? 0 : 1;
      if (unseenA !== unseenB) return unseenA - unseenB;
      const rankA = briefingA ? 1 : 0;
      const rankB = briefingB ? 1 : 0;
      if (rankA !== rankB) return rankA - rankB;
      const timeA = a.startAt ? new Date(a.startAt).getTime() : Infinity;
      const timeB = b.startAt ? new Date(b.startAt).getTime() : Infinity;
      return timeA - timeB;
    });
  }

  function sanitizeBriefingText(value) {
    return cleanDisplayText(value || '');
  }

  function parseJsonFromResponse(answer) {
    const jsonMatch = answer.match(/```json\s*([\s\S]*?)```/) || answer.match(/\{[\s\S]*\}/);
    const jsonStr = jsonMatch ? (jsonMatch[1] || jsonMatch[0]) : answer;
    return JSON.parse(jsonStr);
  }

  async function buildDayBriefingPrompt() {
    // Read the day-briefing prompt template
    let template = '';
    try {
      const result = await window.workiq.readPromptFile('day-briefing.md');
      if (result.success && result.content) template = result.content.trim();
    } catch (_) {}

    if (!template) {
      template = 'You are preparing a "My Day" morning briefing that synthesizes my full workday from grounded Microsoft 365 context.';
    }

    const today = new Date().toLocaleDateString('en-US', { weekday: 'long', year: 'numeric', month: 'long', day: 'numeric' });

    const mtgs = $meetings.map((m) => {
      const startAt = m.startAt ? safeDate(m.startAt, m.startAt) : 'Unknown time';
      return `- ${m.title || 'Untitled'} at ${startAt} (organizer: ${m.organizer || 'Unknown'})`;
    });
    const meetingsBlock = mtgs.length
      ? `Today's meetings:\n${mtgs.join('\n')}`
      : 'No meetings scheduled today — light day.';

    const tracked = $items
      .filter((i) => i.lifecycleStatus !== 'complete' && i.lifecycleStatus !== 'archived')
      .map((i) => {
        const dueInfo = i.dueAt ? `due ${i.dueAt}` : 'no due date';
        return `- ${i.title || 'Untitled'} [${i.severity || 'Observe'}] (${i.status || 'Unknown'}, ${dueInfo})`;
      });
    const trackedBlock = tracked.length
      ? `Active tracked items:\n${tracked.join('\n')}`
      : 'No active tracked items.';

    const k = $kpis;
    const kpiBlock = (k.critical != null || k.elevated != null || k.observe != null)
      ? `Current radar KPIs: Critical=${k.critical ?? 0}, Elevated=${k.elevated ?? 0}, Observe=${k.observe ?? 0}`
      : 'No radar KPIs available yet.';

    const schema = `

Return only valid JSON and nothing else:
{
  "generatedAt": "ISO-8601 timestamp",
  "headline": "string",
  "topPriorities": ["string"],
  "meetingsRequiringPrep": [{ "title": "string", "startAt": "ISO-8601 or null", "whyPrepNeeded": "string" }],
  "atRiskItems": [{ "title": "string", "severity": "Critical|Elevated|Observe", "risk": "string" }],
  "suggestedTimeBlocks": [{ "time": "string", "activity": "string", "rationale": "string" }],
  "todayFollowUps": ["string"],
  "sources": [{ "label": "string", "type": "meeting|message|doc", "url": "https URL" }]
}`;

    return `${template}\n\nToday's date: ${today}\n\n${meetingsBlock}\n\n${trackedBlock}\n\n${kpiBlock}${schema}`;
  }

  async function buildMeetingBriefingPrompt(meeting) {
    let template = '';
    try {
      const result = await window.workiq.readPromptFile('briefing.md');
      if (result.success && result.content) template = result.content.trim();
    } catch (_) {}

    if (!template) {
      template = 'You are preparing me for an upcoming meeting using grounded Microsoft 365 context.';
    }

    const startAt = meeting?.startAt ? safeDate(meeting.startAt, meeting.startAt) : 'Unknown time';
    const joinUrl = meeting?.joinUrl || 'No link';

    const meetingDetails = `\n\nMeeting details:\n- Title: ${meeting?.title || 'Untitled meeting'}\n- Start: ${startAt}\n- Organizer: ${meeting?.organizer || 'Unknown organizer'}\n- Join URL: ${joinUrl}`;

    const schema = `

Use grounded Microsoft 365 context relevant to this meeting.

Return only valid JSON and nothing else:
{
  "generatedAt": "ISO-8601 timestamp",
  "headline": "string",
  "upcomingMeeting": { "id": "string", "title": "string", "startAt": "ISO-8601 or null", "organizer": "string", "joinUrl": "https URL or null" },
  "keyUpdates": ["string"],
  "decisionsNeeded": ["string"],
  "topRisks": ["string"],
  "talkTrack": ["string"],
  "todayFollowUps": ["string"],
  "sources": [{ "label": "string", "type": "meeting|message|doc", "url": "https URL" }]
}`;

    return `${template}${meetingDetails}${schema}`;
  }

  async function handleDayGenerate() {
    if (dayGenerating) return;
    if (!window.workiq || typeof window.workiq.ask !== 'function') return;

    dayGenerating = true;
    addHistory('recommendation', 'Day briefing generation requested');

    try {
      const prompt = await buildDayBriefingPrompt();
      const result = await window.workiq.ask(prompt);
      if (!result.success) throw new Error(result.error || 'Day briefing query failed');

      const payload = parseJsonFromResponse(result.answer);
      if (!payload || typeof payload.headline !== 'string') throw new Error('Invalid day briefing response');

      const explicitSources = Array.isArray(payload.sources)
        ? payload.sources
            .map((s) => ({
              label: sanitizeBriefingText(s?.label || 'Source'),
              type: sanitizeBriefingText(s?.type || 'source'),
              url: normalizeExternalUrl(s?.url || ''),
            }))
            .filter((s) => s.url)
        : [];

      const normalizedDayBriefing = {
        headline: sanitizeBriefingText(payload.headline || 'Your day at a glance'),
        topPriorities: Array.isArray(payload.topPriorities) ? payload.topPriorities.map(sanitizeBriefingText) : [],
        meetingsRequiringPrep: Array.isArray(payload.meetingsRequiringPrep)
          ? payload.meetingsRequiringPrep.map((m) => ({
              title: sanitizeBriefingText(m?.title || 'Meeting'),
              startAt: m?.startAt || null,
              whyPrepNeeded: sanitizeBriefingText(m?.whyPrepNeeded || ''),
            }))
          : [],
        atRiskItems: Array.isArray(payload.atRiskItems)
          ? payload.atRiskItems.map((i) => ({
              title: sanitizeBriefingText(i?.title || 'Item'),
              severity: sanitizeBriefingText(i?.severity || 'Observe'),
              risk: sanitizeBriefingText(i?.risk || ''),
            }))
          : [],
        suggestedTimeBlocks: Array.isArray(payload.suggestedTimeBlocks)
          ? payload.suggestedTimeBlocks.map((b) => ({
              time: sanitizeBriefingText(b?.time || ''),
              activity: sanitizeBriefingText(b?.activity || ''),
              rationale: sanitizeBriefingText(b?.rationale || ''),
            }))
          : [],
        todayFollowUps: Array.isArray(payload.todayFollowUps) ? payload.todayFollowUps.map(sanitizeBriefingText) : [],
        sources: explicitSources,
        generatedAt: payload.generatedAt || nowIso(),
      };

      briefingsByMeetingId.update((byId) => ({ ...byId, [DAY_BRIEFING_KEY]: normalizedDayBriefing }));
      savePersistentState();
      addHistory('scan', 'Day briefing generated.');
    } catch (err) {
      addHistory('failure', `Day briefing generation failed: ${err.message}`);
    } finally {
      dayGenerating = false;
    }
  }

  async function handleMeetingGenerate(data) {
    const { meetingId } = data;
    const meeting = $meetings.find((m) => m.id === meetingId);
    if (!meeting) return;
    if (meetingGeneratingId) return;
    if (!window.workiq || typeof window.workiq.ask !== 'function') return;

    meetingGeneratingId = meetingId;
    addHistory('recommendation', `Briefing generation requested for: ${meeting.title}`, { meetingId });

    try {
      const prompt = await buildMeetingBriefingPrompt(meeting);
      const result = await window.workiq.ask(prompt);
      if (!result.success) throw new Error(result.error || 'Meeting briefing query failed');

      const payload = parseJsonFromResponse(result.answer);
      if (!payload || typeof payload.headline !== 'string') throw new Error('Invalid meeting briefing response');

      // Ensure upcomingMeeting is populated
      if (!payload.upcomingMeeting || typeof payload.upcomingMeeting !== 'object') {
        payload.upcomingMeeting = {};
      }
      payload.upcomingMeeting.id = payload.upcomingMeeting.id || meeting.id;
      payload.upcomingMeeting.title = payload.upcomingMeeting.title || meeting.title;
      payload.upcomingMeeting.startAt = payload.upcomingMeeting.startAt || meeting.startAt;
      payload.upcomingMeeting.organizer = payload.upcomingMeeting.organizer || meeting.organizer;
      payload.upcomingMeeting.joinUrl = payload.upcomingMeeting.joinUrl || meeting.joinUrl;

      const explicitSources = Array.isArray(payload.sources)
        ? payload.sources
            .map((s) => ({
              label: sanitizeBriefingText(s?.label || 'Source'),
              type: sanitizeBriefingText(s?.type || 'source'),
              url: normalizeExternalUrl(s?.url || ''),
            }))
            .filter((s) => s.url)
        : [];

      const meetingJoinUrl = normalizeExternalUrl(payload.upcomingMeeting.joinUrl || '')
        || explicitSources.find((s) => /teams\.microsoft\.com/i.test(s.url))?.url
        || null;

      const normalizedBriefing = {
        meetingId: meeting.id,
        headline: sanitizeBriefingText(payload.headline || 'Briefing unavailable'),
        upcomingMeeting: {
          id: meeting.id,
          title: sanitizeBriefingText(payload.upcomingMeeting.title || meeting.title),
          startAt: payload.upcomingMeeting.startAt || meeting.startAt,
          organizer: sanitizeBriefingText(payload.upcomingMeeting.organizer || meeting.organizer),
          joinUrl: meetingJoinUrl || meeting.joinUrl || null,
        },
        bullets: Array.isArray(payload.bullets) ? payload.bullets.map(sanitizeBriefingText)
          : Array.isArray(payload.keyUpdates) ? payload.keyUpdates.map(sanitizeBriefingText) : [],
        keyUpdates: Array.isArray(payload.keyUpdates) ? payload.keyUpdates.map(sanitizeBriefingText) : [],
        decisionsNeeded: Array.isArray(payload.decisionsNeeded) ? payload.decisionsNeeded.map(sanitizeBriefingText) : [],
        topRisks: Array.isArray(payload.topRisks) ? payload.topRisks.map(sanitizeBriefingText) : [],
        talkTrack: Array.isArray(payload.talkTrack) ? payload.talkTrack.map(sanitizeBriefingText) : [],
        todayPlan: Array.isArray(payload.todayPlan) ? payload.todayPlan.map(sanitizeBriefingText)
          : Array.isArray(payload.todayFollowUps) ? payload.todayFollowUps.map(sanitizeBriefingText) : [],
        todayFollowUps: Array.isArray(payload.todayFollowUps) ? payload.todayFollowUps.map(sanitizeBriefingText) : [],
        sources: explicitSources,
        generatedAt: payload.generatedAt || nowIso(),
      };

      briefingsByMeetingId.update((byId) => ({ ...byId, [meeting.id]: normalizedBriefing }));
      savePersistentState();
      addHistory('scan', `Briefing generated for: ${meeting.title}`, { meetingId });
    } catch (err) {
      addHistory('failure', `Briefing generation failed for ${meeting.title}: ${err.message}`, { meetingId });
    } finally {
      meetingGeneratingId = null;
    }
  }

  function handleMeetingToggle(data) {
    const { meetingId, open } = data;
    expandedBriefingMeetingIds.update((ids) => {
      if (open && !ids.includes(meetingId)) return [...ids, meetingId];
      if (!open && ids.includes(meetingId)) return ids.filter((id) => id !== meetingId);
      return ids;
    });
  }
</script>

<div class="panel panel--full">
  <h2>Briefings</h2>
  <div class="panel-sub">Upcoming meetings today; expand one and generate a focused briefing</div>

  <DayBriefingCard
    briefing={dayBriefing}
    unseen={dayBriefingUnseen}
    ongenerate={handleDayGenerate}
  />

  {#if sortedMeetings.length}
    {#each sortedMeetings as meeting (meeting.id)}
      <MeetingCard
        {meeting}
        briefing={getBriefing(meeting.id)}
        unseen={isMeetingBriefingUnseen(meeting.id, getBriefing(meeting.id), $briefingSeenAt)}
        expanded={$expandedBriefingMeetingIds.includes(meeting.id)}
        ongenerate={handleMeetingGenerate}
        ontoggle={handleMeetingToggle}
      />
    {/each}
  {:else}
    <div class="empty">No upcoming meetings for today. Click Refresh to reload.</div>
  {/if}
</div>
