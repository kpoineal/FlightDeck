<script>
  import { mergeDestinations } from '../lib/thread-merging.js';
  let { source, onselect, oncancel } = $props();
  let query = $state('');
  let rows = $state([]);
  let error = $state('');
  let loading = $state(true);
  let dialog = $state(null);
  let request = 0;
  $effect(() => {
    if (dialog && !dialog.open) { dialog.showModal(); dialog.querySelector('input')?.focus(); }
  });
  $effect(() => {
    const search = query;
    const sequence = ++request;
    loading = true;
    const timer = setTimeout(async () => {
      try {
        const result = await mergeDestinations(source.id, search);
        if (sequence === request) { rows = result; error = ''; }
      } catch (_) {
        if (sequence === request) error = 'Could not load destinations. No threads changed.';
      } finally { if (sequence === request) loading = false; }
    }, 150);
    return () => clearTimeout(timer);
  });
</script>

<dialog bind:this={dialog} class="merge-dialog" aria-labelledby="merge-title"
  data-testid="merge-picker" oncancel={(event) => { event.preventDefault(); oncancel(); }}>
  <div class="modal-card">
    <h3 id="merge-title">Merge into…</h3>
    <p class="panel-sub">Choose the active thread to keep. Search all stored threads. Up to 30 results.</p>
    <input aria-label="Search destination threads" data-testid="merge-search" bind:value={query} placeholder="Search threads…" />
    {#if error}<p role="alert">{error}</p>{/if}
    <div class="merge-results" aria-busy={loading}>
      {#each rows as row (row.id)}
        <button class="small-btn" data-testid="merge-destination" disabled={loading} onclick={() => onselect(row.id)}>{row.title}</button>
      {:else}
        <p>{loading ? 'Loading…' : 'No active destinations found.'}</p>
      {/each}
    </div>
    <div class="modal-actions"><button class="small-btn" data-testid="merge-cancel" onclick={oncancel}>Cancel</button></div>
  </div>
</dialog>

<style>
  .merge-dialog { padding: 0; border: 1px solid var(--border); border-radius: 12px; background: var(--surface); color: inherit; width: min(460px, calc(100vw - 24px)); max-height: 85vh; }
  .merge-dialog::backdrop { background: #0008; }
  .modal-card { width: auto; }
  input { width: 100%; box-sizing: border-box; }
  .merge-results { display: flex; flex-direction: column; gap: 6px; margin-top: 12px; max-height: 45vh; overflow-y: auto; }
  .merge-results button { text-align: left; white-space: normal; }
</style>
