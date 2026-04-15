<script>
  import { safeDate, sanitizeBriefingText } from '../lib/utils.js';

  export let briefing;

  $: headline = briefing.headline || 'Meeting Briefing';
  $: generatedAt = safeDate(briefing.generatedAt, 'Unknown');

  $: keyUpdates = briefing.keyUpdates?.length ? briefing.keyUpdates : [];
  $: decisionsNeeded = briefing.decisionsNeeded?.length ? briefing.decisionsNeeded : [];
  $: topRisks = briefing.topRisks?.length ? briefing.topRisks : [];
  $: talkTrack = briefing.talkTrack?.length ? briefing.talkTrack : [];
  $: followUps = briefing.todayFollowUps?.length
    ? briefing.todayFollowUps
    : briefing.todayPlan?.length
      ? briefing.todayPlan
      : [];
  $: sources = briefing.sources?.length ? briefing.sources : [];
</script>

<div class="evidence-box">
  <h3>{sanitizeBriefingText(headline)}</h3>
  <div class="panel-sub">Generated: {generatedAt}</div>

  <h4>Key Updates</h4>
  <ul>
    {#if keyUpdates.length}
      {#each keyUpdates as line}
        <li>{sanitizeBriefingText(line)}</li>
      {/each}
    {:else}
      <li>No key updates yet.</li>
    {/if}
  </ul>

  <h4>Decisions Needed</h4>
  <ul>
    {#if decisionsNeeded.length}
      {#each decisionsNeeded as line}
        <li>{sanitizeBriefingText(line)}</li>
      {/each}
    {:else}
      <li>No explicit decisions listed.</li>
    {/if}
  </ul>

  <h4>Top Risks</h4>
  <ul>
    {#if topRisks.length}
      {#each topRisks as line}
        <li>{sanitizeBriefingText(line)}</li>
      {/each}
    {:else}
      <li>No risks listed.</li>
    {/if}
  </ul>

  <h4>Talk Track</h4>
  <ul>
    {#if talkTrack.length}
      {#each talkTrack as line}
        <li>{sanitizeBriefingText(line)}</li>
      {/each}
    {:else}
      <li>No talk track yet.</li>
    {/if}
  </ul>

  <h4>Follow-Ups</h4>
  <ul>
    {#if followUps.length}
      {#each followUps as line}
        <li>{sanitizeBriefingText(line)}</li>
      {/each}
    {:else}
      <li>No follow-up items.</li>
    {/if}
  </ul>

  <h4>Sources</h4>
  <ul>
    {#if sources.length}
      {#each sources as entry, index}
        <li>
          <a href={entry.url} target="_blank" rel="noopener noreferrer">
            {entry.label || `source ${index + 1}`}
          </a>
        </li>
      {/each}
    {:else}
      <li>No sources listed.</li>
    {/if}
  </ul>
</div>
