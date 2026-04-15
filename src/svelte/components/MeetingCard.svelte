<script>
  import { createEventDispatcher } from 'svelte';
  import { safeDate } from '../lib/utils.js';
  import BriefingContent from './BriefingContent.svelte';

  export let meeting;
  export let briefing = null;
  export let unseen = false;
  export let expanded = false;

  const dispatch = createEventDispatcher();

  $: hasBriefing = !!briefing;
  $: severityClass = hasBriefing ? 'briefed' : 'unbriefed';
  $: statusLabel = hasBriefing ? 'Briefed' : 'Unbriefed';
  $: buttonLabel = hasBriefing ? 'Regenerate Briefing' : 'Generate Briefing';
  $: when = safeDate(meeting.startAt, 'Unknown');

  function handleToggle(event) {
    dispatch('toggle', { meetingId: meeting.id, open: event.target.open });
  }

  function handleGenerate() {
    dispatch('generate', { meetingId: meeting.id });
  }
</script>

<details
  class="list-card"
  data-briefing-meeting-id={meeting.id}
  open={expanded}
  on:toggle={handleToggle}
>
  <summary>
    <span class="pill {severityClass}">{statusLabel}</span>
    {#if unseen}
      <span class="pill briefed">New</span>
    {/if}
    <span class="list-title">{meeting.title}</span>
  </summary>
  <div class="card-body">
    <div class="meta">
      <span>When: {when}</span>
      <span>Organizer: {meeting.organizer}</span>
      <span>Join:
        {#if meeting.joinUrl}
          <a href={meeting.joinUrl} target="_blank" rel="noopener noreferrer">join meeting</a>
        {:else}
          No join link
        {/if}
      </span>
    </div>
    <div class="action-row">
      <button class="small-btn primary" on:click={handleGenerate}>
        {buttonLabel}
      </button>
    </div>
    {#if briefing}
      <BriefingContent {briefing} />
    {:else}
      <div class="empty">No briefing generated yet.</div>
    {/if}
  </div>
</details>
