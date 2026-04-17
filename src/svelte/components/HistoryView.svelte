<script>
  import HistoryItem from './HistoryItem.svelte';

  let { history = [] } = $props();
</script>

{#if history.length === 0}
  <div class="empty">No audit entries yet.</div>
{:else}
  {#each history as entry (entry.at)}
    <HistoryItem {entry} />
  {/each}
{/if}
