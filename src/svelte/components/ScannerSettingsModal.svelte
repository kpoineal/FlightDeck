<script>
  import { createEventDispatcher } from 'svelte';
  import ScannerForm from './ScannerForm.svelte';

  export let open = false;
  export let scanner = null;

  const dispatch = createEventDispatcher();

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) dispatch('close');
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="modal show" role="dialog" aria-modal="true" on:click={handleBackdrop}>
    <div class="modal-card">
      <h3 class="scanner-modal-title">{scanner ? (scanner.name || 'Scanner Settings') : 'New Scanner'}</h3>
      <ScannerForm {scanner}
        on:save={(e) => dispatch('save', e.detail)}
        on:runnow={() => dispatch('runnow')}
        on:cancel={() => dispatch('close')} />
      {#if scanner}
        <button class="scanner-modal-delete"
          on:click={() => dispatch('delete', { scannerId: scanner.id })}>Delete this scanner</button>
      {/if}
    </div>
  </div>
{/if}
