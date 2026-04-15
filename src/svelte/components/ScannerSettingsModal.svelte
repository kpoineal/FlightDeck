<script>
  import ScannerForm from './ScannerForm.svelte';

  let { open = false, scanner = null, onsave, onrunnow, ondelete, onclose } = $props();

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) onclose?.();
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="modal show" role="dialog" aria-modal="true" on:click={handleBackdrop}>
    <div class="modal-card">
      <h3 class="scanner-modal-title">{scanner ? (scanner.name || 'Scanner Settings') : 'New Scanner'}</h3>
      <ScannerForm {scanner}
        onsave={(data) => onsave?.(data)}
        onrunnow={() => onrunnow?.()}
        oncancel={() => onclose?.()} />
      {#if scanner}
        <button class="scanner-modal-delete"
          on:click={() => ondelete?.({ scannerId: scanner.id })}>Delete this scanner</button>
      {/if}
    </div>
  </div>
{/if}
