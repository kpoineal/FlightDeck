<script>
  import { createEventDispatcher } from 'svelte';
  const dispatch = createEventDispatcher();
</script>

<div class="connect-banner">
  <p><strong>Connect:</strong> Requires Node.js, Copilot license, and tenant admin consent for WorkIQ data access.</p>
  <button class="btn" on:click={() => dispatch('enable')}>Enable WorkIQ</button>
</div>
