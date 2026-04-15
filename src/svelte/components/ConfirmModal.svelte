<script>
  export let open = false;
  export let summary = '';
  export let targets = '';

  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) dispatch('cancel');
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="modal show" role="dialog" aria-modal="true" on:click={handleBackdrop}>
    <div class="modal-card">
      <h3>Confirm Action</h3>
      <p class="panel-sub">{summary}</p>
      <div class="confirm-targets">{targets}</div>
      <div class="modal-actions">
        <button class="small-btn" on:click={() => dispatch('cancel')}>Cancel</button>
        <button class="small-btn warn" on:click={() => dispatch('confirm')}>Confirm</button>
      </div>
    </div>
  </div>
{/if}
