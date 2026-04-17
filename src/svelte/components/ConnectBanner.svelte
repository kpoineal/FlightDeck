<script>
  let { onenable } = $props();
</script>

<div class="connect-banner">
  <p><strong>Connect:</strong> Requires Node.js, Copilot license, and tenant admin consent for WorkIQ data access.</p>
  <button class="btn" on:click={() => onenable?.()}>Enable WorkIQ</button>
</div>
