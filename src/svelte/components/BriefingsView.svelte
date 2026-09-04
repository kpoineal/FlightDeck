<script>
  import { meetings, briefingsByMeetingId, briefingSeenAt, expandedBriefingMeetingIds, items, kpis, actionProposals, openActionsQueue, selectedProposalId } from '../lib/stores.js';
  import { DAY_BRIEFING_KEY } from '../lib/constants.js';
  import { addHistory } from '../lib/actions.js';
  import { savePersistentState } from '../lib/persistence.js';
  import { nowIso, safeDate, cleanDisplayText, normalizeExternalUrl } from '../lib/utils.js';
  import { buildMeetingBriefingPrompt, buildDayBriefingPrompt } from '../lib/prompts.js';
  import { runWorkiqJson } from '../lib/json-parser.js';
  import DayBriefingCard from './DayBriefingCard.svelte';
  import MeetingCard from './MeetingCard.svelte';
  import { createActionProposal } from '../lib/action-proposals.js';

  let { onrefresh } = $props();

  let dayGenerating = $state(false);
  let meetingGeneratingId = $state(null);
  let refreshing = $state(false);

  async function handleRefresh() {
    if (refreshing) return;
    refreshing = true;
    try {
      await onrefresh?.();
    } finally {
      refreshing = false;
    }
  }

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

  async function loadPromptTemplate(name) {
    try {
      const result = await window.workiq.readPromptFile(name);
      if (result.success && result.content) return result.content.trim();
    } catch (_) {}
    return '';
  }

  async function handleDayGenerate() {
    if (dayGenerating) return;
    if (!window.workiq || typeof window.workiq.ask !== 'function') return;

    dayGenerating = true;
    addHistory('recommendation', 'Day briefing generation requested');

    try {
      const template = await loadPromptTemplate('day-briefing.md');
      const prompt = buildDayBriefingPrompt($items, $meetings, $kpis, template);
      const payload = await runWorkiqJson(
        prompt,
        (p) => p && typeof p.headline === 'string',
        'day-briefing'
      );

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
      const template = await loadPromptTemplate('briefing.md');
      const prompt = buildMeetingBriefingPrompt(meeting, template);
      const payload = await runWorkiqJson(
        prompt,
        (p) => p && typeof p.headline === 'string',
        'meeting-briefing'
      );

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

  function handlePropose(data) {
    const meeting = $meetings.find((entry) => entry.id === data.meetingId);
    const matchedItem = $items.find((item) => {
      const haystack = `${meeting?.title || ''} ${meeting?.summary || ''}`.toLowerCase();
      return String(item.title || '').split(/\s+[—-]\s+/)[0].toLowerCase().split(' ').some((word) => word.length > 5 && haystack.includes(word));
    });
    const briefing = getBriefing(meeting.id);
    const sourceItem = matchedItem || {
      id: `meeting_${meeting.id}`,
      title: meeting.title,
      sourceType: 'Meeting',
      owner: meeting.organizer,
      counterparties: [meeting.organizer].filter(Boolean),
      summary: meeting.summary || briefing?.headline,
      evidenceLinks: (briefing?.sources || []).map((source) => ({ label: source.label, url: source.url })),
      severity: 'Observe',
    };
    const proposal = createActionProposal(
      sourceItem,
      `Prepare the follow-up for ${meeting?.title || sourceItem.title} using the generated briefing and linked evidence.`,
      {
        reason: `Meeting readiness follow-up proposed from ${meeting?.title || 'Briefings'}.`,
        sourceDestination: 'Briefings',
        sourceContextId: meeting.id,
      }
    );
    actionProposals.update((entries) => [proposal, ...entries]);
    selectedProposalId.set(proposal.id);
    openActionsQueue(data.initiator);
  }
</script>

<div class="command-view briefing-command">
  <div class="command-view__heading briefings-header">
    <div>
      <span>BRIEFINGS</span>
      <h1>Now / Next / Later</h1>
      <p>Meeting readiness, generated briefs, and linked evidence</p>
    </div>
    <button class="small-btn" class:is-loading={refreshing} disabled={refreshing} on:click={handleRefresh}>
      {refreshing ? 'Refreshing...' : '↻ Refresh Meetings'}
    </button>
  </div>

  <section class="briefing-now">
    <div class="briefing-lane-label"><strong>Now</strong><span>Operating brief</span></div>
    <DayBriefingCard briefing={dayBriefing} unseen={dayBriefingUnseen} generating={dayGenerating} ongenerate={handleDayGenerate} />
  </section>

  {#each [
    { label: 'Next', hint: 'Prepare before these start', meetings: sortedMeetings.slice(0, 2) },
    { label: 'Later', hint: 'Readiness queue', meetings: sortedMeetings.slice(2) }
  ] as lane}
    <section class="briefing-lane">
      <div class="briefing-lane-label"><strong>{lane.label}</strong><span>{lane.hint}</span></div>
      <div class="briefing-lane-content">
        {#each lane.meetings as meeting (meeting.id)}
          <MeetingCard {meeting} briefing={getBriefing(meeting.id)}
            unseen={isMeetingBriefingUnseen(meeting.id, getBriefing(meeting.id), $briefingSeenAt)}
            expanded={$expandedBriefingMeetingIds.includes(meeting.id)}
            generating={meetingGeneratingId === meeting.id}
            ongenerate={handleMeetingGenerate} ontoggle={handleMeetingToggle} onpropose={handlePropose} />
        {:else}<div class="command-empty">No meetings in this horizon.</div>{/each}
      </div>
    </section>
  {/each}
  <footer class="briefing-provenance">Generated content is grounded in linked sources. Source cutoff and provenance remain visible inside each brief.</footer>
</div>

<style>
  .briefings-header {
    display: flex;
    align-items: flex-start;
    justify-content: space-between;
    gap: 16px;
    margin-bottom: 4px;
  }
</style>
