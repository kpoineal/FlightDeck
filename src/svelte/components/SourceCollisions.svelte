<script>
  import { get } from 'svelte/store';
  import { items, scanners, deletedItemIds } from '../lib/stores.js';
  import { collectItemSourceIdentities } from '../lib/models/item.js';
  import { findSourceCollisions } from '../../shared/source-collisions.mjs';
  import { usesRepository } from '../lib/persistence.js';
  let groups = $state(null);
  let pending = $state(false);
  let failed = $state(false);
  let page = $state(0);
  let cursor = $state(null);
  let cursors = [null];
  const database = usesRepository();
  let reportRevision;
  async function inspect(after = null, index = 0) {
    pending = true;
    failed = false;
    try {
      if (database) {
        const result = await window.workiq.stateQuery('collisionGroups', {
          after: after || '', limit: 100, ...(after ? { revision: reportRevision } : {}),
        });
        reportRevision = result.revision;
        groups = result.groups;
        cursor = result.cursor;
        page = index;
        return;
      }
      const cold = await window.workiq.getColdItems();
      if (!Array.isArray(cold)) throw new Error('INVALID_COLD_STATE');
      groups = findSourceCollisions({
        hot: get(items), cold, scanners: get(scanners), deletedItemIds: get(deletedItemIds),
      }, collectItemSourceIdentities);
      page = 0;
    } catch (_) { failed = true; }
    finally { pending = false; }
  }
</script>

<section class="source-review">
  <h3>Source identity review</h3>
  <p>Inspect exact qualified sources across retained hot and archive records. This does not merge or delete anything.</p>
  <button class="small-btn" disabled={pending} onclick={() => { cursors = [null]; void inspect(); }}>{pending ? 'Inspecting…' : 'Review source collisions'}</button>
  {#if failed}<p role="alert">Could not read all retained records. No incomplete report is shown.</p>{/if}
  {#if groups && !failed}
    <p>{groups.length} colliding source identities{database ? ' on this page' : ''}. Different scanners may intentionally retain the same source; title similarity is not used.</p>
    <button class="small-btn" disabled={pending || page === 0} onclick={() => database ? inspect(cursors[page - 1], page - 1) : page--}>Previous collisions</button>
    <button class="small-btn" disabled={pending || (database ? !cursor : (page + 1) * 100 >= groups.length)} onclick={() => {
      if (database) { cursors[page + 1] = cursor; void inspect(cursor, page + 1); } else page++;
    }}>Next collisions</button>
    {#each (database ? groups : groups.slice(page * 100, (page + 1) * 100)) as group}
      <details>
        <summary>{group.identity} — {group.owners.length} owners {group.sameScannerCollision ? '(same-scanner collision)' : '(cross-scanner)'}</summary>
        {#if group.allowsCrossScannerDuplicate}<p>At least one owning scanner allows cross-scanner duplicates. Policy is candidate-scanner specific.</p>{/if}
        {#if group.truncated}<p>Showing the first 100 of {group.ownerCount} owners for this identity.</p>{/if}
        <ul>{#each group.owners as owner}
          <li>{owner.title} — {owner.threadId} · {owner.tier} · {owner.scannerName} ({owner.scannerId || 'none'}) · cross-scanner dedup: {owner.crossScannerDedup ? 'on' : 'off'}</li>
        {/each}</ul>
      </details>
    {/each}
  {/if}
</section>

<style>
  .source-review { margin-top: 20px; overflow-wrap: anywhere; }
  details { margin-top: 10px; }
</style>
