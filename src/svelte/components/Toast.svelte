<script>
  import { writable } from 'svelte/store';

  let toasts = writable([]);
  let nextId = 0;

  export function showToast(message, { icon = '\u2713', durationMs = 3500 } = {}) {
    const id = nextId++;
    toasts.update((t) => [...t, { id, message, icon }]);
    setTimeout(() => {
      toasts.update((t) => t.filter((item) => item.id !== id));
    }, durationMs);
  }
</script>

{#if $toasts.length}
  <div class="toast-container">
    {#each $toasts as toast (toast.id)}
      <div class="toast">
        <span class="toast-icon">{toast.icon}</span>
        <span class="toast-message">{toast.message}</span>
      </div>
    {/each}
  </div>
{/if}

<style>
  .toast-container {
    position: fixed;
    bottom: 1rem;
    right: 1rem;
    z-index: 9999;
    display: flex;
    flex-direction: column;
    gap: 0.5rem;
  }
  .toast {
    background: var(--bg-elevated, #1e1e2e);
    color: var(--text-primary, #cdd6f4);
    border: 1px solid var(--border-subtle, #45475a);
    border-radius: 6px;
    padding: 0.5rem 1rem;
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.85rem;
    box-shadow: 0 2px 8px rgba(0,0,0,0.3);
    animation: toast-in 0.2s ease-out;
  }
  @keyframes toast-in {
    from { opacity: 0; transform: translateY(8px); }
    to { opacity: 1; transform: translateY(0); }
  }
</style>
