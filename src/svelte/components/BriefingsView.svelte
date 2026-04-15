<script>
  import { meetings, briefingsByMeetingId, briefingSeenAt, expandedBriefingMeetingIds } from '../lib/stores.js';
  import { DAY_BRIEFING_KEY } from '../lib/constants.js';
  import DayBriefingCard from './DayBriefingCard.svelte';
  import MeetingCard from './MeetingCard.svelte';

  $: dayBriefing = $briefingsByMeetingId[DAY_BRIEFING_KEY] || null;
  $: dayBriefingUnseen = isDayBriefingUnseen(dayBriefing, $briefingSeenAt);

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

  $: sortedMeetings = sortMeetings($meetings, $briefingsByMeetingId, $briefingSeenAt);

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

  function handleDayGenerate() {
    // Dispatch to vanilla JS layer via CustomEvent on window
    window.dispatchEvent(new CustomEvent('flightdeck:generate-day-briefing'));
  }

  function handleMeetingGenerate(event) {
    const { meetingId } = event.detail;
    window.dispatchEvent(new CustomEvent('flightdeck:generate-briefing', { detail: { meetingId } }));
  }

  function handleMeetingToggle(event) {
    const { meetingId, open } = event.detail;
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
    on:generate={handleDayGenerate}
  />

  {#if sortedMeetings.length}
    {#each sortedMeetings as meeting (meeting.id)}
      <MeetingCard
        {meeting}
        briefing={getBriefing(meeting.id)}
        unseen={isMeetingBriefingUnseen(meeting.id, getBriefing(meeting.id), $briefingSeenAt)}
        expanded={$expandedBriefingMeetingIds.includes(meeting.id)}
        on:generate={handleMeetingGenerate}
        on:toggle={handleMeetingToggle}
      />
    {/each}
  {:else}
    <div class="empty">No upcoming meetings for today. Click Refresh to reload.</div>
  {/if}
</div>
