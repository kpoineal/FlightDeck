<script>
  let { open = false, summary = '', targets = '', onconfirm, oncancel } = $props();

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) oncancel?.();
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
        <button class="small-btn" on:click={() => oncancel?.()}>Cancel</button>
        <button class="small-btn warn" on:click={() => onconfirm?.()}>Confirm</button>
      </div>
    </div>
  </div>
{/if}
