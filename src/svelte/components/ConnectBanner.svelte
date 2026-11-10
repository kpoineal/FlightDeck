<script>
  import { connectionStatus } from '../lib/stores.js';
  let { onenable } = $props();
</script>

<div class="connect-banner">
  <p><strong>Connect:</strong> {$connectionStatus === 'validating' ? 'Enabling local WorkIQ. Complete WorkIQ sign-in if prompted. Cached data and local edits remain available.' : $connectionStatus === 'failed' ? 'WorkIQ connection failed. Cached data is available; retry to enable local WorkIQ.' : 'Enable the local WorkIQ CLI. Requires a Copilot license and tenant admin consent.'}</p>
  <button class="btn" disabled={$connectionStatus === 'validating'} on:click={() => onenable?.()}>{$connectionStatus === 'failed' ? 'Retry WorkIQ' : 'Enable WorkIQ'}</button>
</div>
