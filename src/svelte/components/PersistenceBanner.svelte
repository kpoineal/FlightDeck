<script>
  import { get } from 'svelte/store';
  import { isDemo, persistenceStatus, persistenceError } from '../lib/stores.js';
  import { flushPersistentState, discardPendingState, exportPendingState, loadPersistentState } from '../lib/persistence.js';
  function exportEdits() {
    const url = URL.createObjectURL(new Blob([JSON.stringify(exportPendingState(), null, 2)], { type: 'application/json' }));
    const link = document.createElement('a');
    link.href = url;
    link.download = 'flightdeck-local-edits.json';
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  }
  async function discard() {
    if (confirm('Discard this window’s unsaved local edits and load the saved profile? Export edits first if you need to keep them.')) {
      await discardPendingState(get(isDemo));
    }
  }
</script>
{#if ['failed', 'conflict', 'load-failed', 'recovery-required'].includes($persistenceStatus)}
  <div role="status" class="persistence-banner">
    Local state: {$persistenceStatus}.
    {#if $persistenceError}<strong>{$persistenceError}</strong>{/if}
    {#if $persistenceStatus === 'failed'}
      <button class="small-btn" onclick={() => flushPersistentState(get(isDemo))}>Retry save</button>
    {/if}
    {#if $persistenceStatus === 'conflict' || $persistenceStatus === 'failed' || $persistenceStatus === 'recovery-required'}
      Local edits are preserved; controlled reload/quit is blocked until resolved.
      <button class="small-btn" onclick={exportEdits}>Export local edits</button>
    {/if}
    {#if $persistenceStatus === 'conflict'}
      <button class="small-btn" onclick={discard}>Discard edits and refresh</button>
    {/if}
    {#if $persistenceStatus === 'load-failed' || $persistenceStatus === 'recovery-required'}
      Keep this window open. The stored profile needs recovery; it has not been replaced with empty data.
      Pre-import originals, when available, are in the profile's state-normal (or state-demo) backup directory. Do not delete the active database or select stale JSON.
      <button class="small-btn" onclick={() => loadPersistentState(get(isDemo))}>Retry reading profile</button>
    {/if}
  </div>
{/if}
<style>
  .persistence-banner { padding: 8px; border: 1px solid var(--border); margin-bottom: 8px; }
</style>
