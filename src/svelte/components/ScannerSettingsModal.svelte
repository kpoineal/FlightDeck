<script>
  import ScannerForm from './ScannerForm.svelte';

  let { open = false, scanner = null, canRun = true, runDisabledReason = '', onsave, onrunnow, ondelete, onclose } = $props();

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onclose?.();
  }

  function handleDelete(event) {
    ondelete?.({ scannerId: scanner.id, returnFocus: event.currentTarget });
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="modal show" role="dialog" aria-modal="true" on:click={handleBackdrop}>
    <div class="modal-card">
      <h3 class="scanner-modal-title">{scanner ? (scanner.name || 'Scanner Settings') : 'New Scanner'}</h3>
      <ScannerForm {scanner}
        {canRun}
        {runDisabledReason}
        onsave={(data) => onsave?.(data)}
        onrunnow={() => onrunnow?.()}
        oncancel={() => onclose?.()} />
      {#if scanner}
        <button type="button" class="scanner-modal-delete" data-testid="scanner-settings-delete"
          on:click={handleDelete}>Delete this scanner</button>
      {/if}
    </div>
  </div>
{/if}
