<script>
  import { onMount } from 'svelte';
  import { connected, isDemo, meetings, briefingsByMeetingId, briefingSeenAt, expandedBriefingMeetingIds, items, coldItems, deletedItemIds, selectedProposalId, dayBriefingGenerating, dayBriefingError } from '../lib/stores.js';
  import { DAY_BRIEFING_KEY } from '../lib/constants.js';
  import { addHistory } from '../lib/actions.js';
  import { savePersistentState } from '../lib/persistence.js';
  import { nowIso, safeDate, cleanDisplayText, normalizeExternalUrl } from '../lib/utils.js';
  import { buildMeetingBriefingPrompt } from '../lib/prompts.js';
  import { generateDayBriefing } from '../lib/briefings.js';
  import { normalizeTodayMeetings } from '../lib/meetings.js';
  import { runWorkiqJson } from '../lib/json-parser.js';
  import DayBriefingCard from './DayBriefingCard.svelte';
  import MeetingCard from './MeetingCard.svelte';
  import { meetingFollowUpId, prepareMeetingFollowUp } from '../lib/meeting-follow-up.js';
  import { navigateToRadarItem, resolveRadarItem, hydrateRadarColdItems } from '../lib/radar-navigation.js';
  import { setItemField } from '../lib/item-actions.js';

  let { onrefresh } = $props();

  let now = $state(Date.now());
  let meetingGeneratingId = $state(null);
  let refreshing = $state(false);
  let followUpPending = $state(false);
  let followUpError = $state('');

  onMount(() => {
    const timer = setInterval(() => { now = Date.now(); }, 60_000);
    return () => clearInterval(timer);
  });

  async function handleRefresh() {
    if (refreshing || !$connected) return;
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

  let sortedMeetings = $derived(sortMeetings(normalizeTodayMeetings($meetings, now), $briefingsByMeetingId, $briefingSeenAt));
  let upcomingMeetings = $derived(sortedMeetings.filter((meeting) => meeting.startTime > now));
  let earlierMeetings = $derived(sortedMeetings.filter((meeting) => meeting.startTime <= now));

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

  async function handleMeetingGenerate(data) {
    if (!$connected) return;
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

  async function handlePropose(data) {
    if (followUpPending) return;
    const meeting = $meetings.find((entry) => entry.id === data.meetingId);
    if (!meeting) { followUpError = 'This meeting is no longer available. Refresh meetings and try again.'; return; }
    followUpPending = true;
    followUpError = '';
    try {
      await resolveRadarItem(meetingFollowUpId(meeting));
      await hydrateRadarColdItems();
      const prepared = prepareMeetingFollowUp(meeting, getBriefing(meeting.id), [...$items, ...$coldItems], $deletedItemIds);
      if (prepared.created) {
        items.update(entries => [{ ...prepared.item, suggestedNextSteps: prepared.suggestedNextSteps,
          workPlanChoice: prepared.workPlanChoice }, ...entries]);
        addHistory('action', `Added meeting follow-up thread "${prepared.item.title}"`, { itemId: prepared.item.id });
      } else {
        setItemField(prepared.item.id, 'summary', prepared.item.summary);
        setItemField(prepared.item.id, 'evidenceLinks', prepared.item.evidenceLinks);
        setItemField(prepared.item.id, 'suggestedNextSteps', prepared.suggestedNextSteps);
        setItemField(prepared.item.id, 'workPlanChoice', prepared.workPlanChoice);
      }
      selectedProposalId.set(null);
      if (!await savePersistentState($isDemo)) throw new Error('The follow-up could not be saved. Resolve the save banner before continuing; the local thread is retained.');
      if (!await navigateToRadarItem(prepared.item.id)) throw new Error('The follow-up thread could not be opened. Find it in Radar and try again.');
    } catch (failure) {
      followUpError = failure.message || 'Could not prepare the follow-up thread. Try again.';
    } finally {
      followUpPending = false;
    }
  }
</script>

<div class="command-view briefing-command">
  {#if followUpError}<p role="alert">{followUpError}</p>{/if}
  {#if followUpPending}<p role="status">Opening the meeting follow-up Work plan…</p>{/if}
  <div class="command-view__heading briefings-header">
    <div>
      <span>BRIEFINGS</span>
      <h1>Now / Next / Later</h1>
      <p>Meeting readiness, generated briefs, and linked evidence</p>
    </div>
    <button class="small-btn" class:is-loading={refreshing} disabled={refreshing || !$connected} on:click={handleRefresh}>
      {refreshing ? 'Refreshing...' : '↻ Refresh Meetings'}
    </button>
  </div>

  <section class="briefing-now">
    <div class="briefing-lane-label"><strong>Now</strong><span>Operating brief</span></div>
    <DayBriefingCard briefing={dayBriefing} unseen={dayBriefingUnseen}
      generating={$dayBriefingGenerating} error={$dayBriefingError} ongenerate={() => generateDayBriefing()} />
  </section>

  {#each [
    { label: 'Next', hint: 'Prepare before these start', meetings: upcomingMeetings.slice(0, 2) },
    { label: 'Later', hint: 'Readiness queue', meetings: upcomingMeetings.slice(2) },
    ...(earlierMeetings.length ? [{ label: 'Earlier today', hint: 'Started or finished; briefings still available', meetings: earlierMeetings }] : [])
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
