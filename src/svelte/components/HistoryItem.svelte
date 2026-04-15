<script>
  import { safeDate } from '../lib/utils.js';

  export let entry;

  $: time = safeDate(entry.at, 'Unknown');
  $: links = Array.isArray(entry.payload?.newLinks) ? entry.payload.newLinks : [];
  $: hasLinks = links.length > 0;
</script>

<article class="history-item">
  <div><strong>{entry.kind.toUpperCase()}</strong> &bull; {time}</div>
  <div>{entry.summary}</div>
  {#if hasLinks}
    <ul class="source-list source-list--inline">
      {#each links as link}
        <li>
          {link.type || 'source'} &bull;
          <a href={link.url} target="_blank" rel="noreferrer">
            {link.label || 'source'}
          </a>
        </li>
      {/each}
    </ul>
  {/if}
</article>
