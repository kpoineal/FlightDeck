<script>
  import { safeDate } from '../lib/utils.js';

  let { entry } = $props();

  let time = $derived(safeDate(entry.at, 'Unknown'));
  let links = $derived(Array.isArray(entry.payload?.newLinks) ? entry.payload.newLinks : []);
  let hasLinks = $derived(links.length > 0);
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
