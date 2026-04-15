<script>
  import { safeDate, sanitizeBriefingText } from '../lib/utils.js';

  let { briefing } = $props();

  let headline = $derived(briefing.headline || 'Meeting Briefing');
  let generatedAt = $derived(safeDate(briefing.generatedAt, 'Unknown'));

  let keyUpdates = $derived(briefing.keyUpdates?.length ? briefing.keyUpdates : []);
  let decisionsNeeded = $derived(briefing.decisionsNeeded?.length ? briefing.decisionsNeeded : []);
  let topRisks = $derived(briefing.topRisks?.length ? briefing.topRisks : []);
  let talkTrack = $derived(briefing.talkTrack?.length ? briefing.talkTrack : []);
  let followUps = $derived(briefing.todayFollowUps?.length
    ? briefing.todayFollowUps
    : briefing.todayPlan?.length
      ? briefing.todayPlan
      : []);
  let sources = $derived(briefing.sources?.length ? briefing.sources : []);
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
