<script>
  import { connectionStatus } from '../lib/stores.js';
  let { onenable } = $props();
</script>

<div class="connect-banner">
  <p><strong>Connect:</strong> {$connectionStatus === 'validating' ? 'Validating WorkIQ. Cached data and local edits remain available.' : $connectionStatus === 'failed' ? 'WorkIQ validation failed. Cached data is available; retry when ready.' : 'Requires Node.js, Copilot license, and tenant admin consent for WorkIQ data access.'}</p>
  <button class="btn" disabled={$connectionStatus === 'validating'} on:click={() => onenable?.()}>{$connectionStatus === 'failed' ? 'Retry WorkIQ' : 'Enable WorkIQ'}</button>
</div>
