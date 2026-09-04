<script>
  import { items } from '../lib/stores.js';
  import { navigateToRadarItem } from '../lib/radar-navigation.js';
  import { safeDate } from '../lib/utils.js';

  let { history = [] } = $props();
  let selectedItemId = $state('all');
  let kind = $state('all');
  let selectedItem = $derived($items.find((item) => item.id === selectedItemId) || null);
  let contextual = $derived.by(() => {
    if (!selectedItem) return [];
    const entries = [
      ...(selectedItem.updateHistory || []).map((entry) => ({
        at: entry.timestamp,
        actor: entry.kind === 'reply' ? 'Monitor' : 'You',
        object: selectedItem.title,
        event: entry.event || entry.kind || 'update',
        source: entry.sourceType || selectedItem.sourceType || 'FlightDeck',
        outcome: entry.summary || entry.changes?.join(' · ') || 'Updated',
        eventId: entry.eventId || null,
        itemId: selectedItem.id,
        kind: entry.kind || 'event',
      })),
      ...history.filter((entry) => entry.payload?.itemId === selectedItem.id).map(normalize),
    ].sort((a, b) => Date.parse(b.at || 0) - Date.parse(a.at || 0));
    const seenEventIds = new Set();
    return entries.filter((entry) => {
      if (!entry.eventId) return true;
      if (seenEventIds.has(entry.eventId)) return false;
      seenEventIds.add(entry.eventId);
      return true;
    });
  });
  let globalEntries = $derived(history.map(normalize).filter((entry) =>
    kind === 'all' || entry.kind === kind || entry.event === kind
  ));
  let eventKinds = $derived([...new Set(history.map((entry) => entry.kind).filter(Boolean))]);

  function normalize(entry) {
    const itemId = entry.payload?.itemId || null;
    const sourceItem = itemId ? $items.find((item) => item.id === itemId) : null;
    const outcome = entry.kind === 'action' ? actionOutcome(entry) : entry.payload?.outcome || entry.summary || 'Recorded';
    return {
      at: entry.at,
      actor: entry.payload?.actor || (entry.kind === 'scan' ? 'Monitor' : 'You'),
      object: entry.payload?.object || sourceItem?.title || (itemId ? 'Source thread' : entry.payload?.meetingId || 'FlightDeck'),
      event: entry.payload?.event || entry.kind || 'event',
      source: entry.payload?.source || 'FlightDeck',
      outcome,
      kind: entry.kind || 'event',
      eventId: entry.eventId || null,
      itemId,
    };
  }

  function actionOutcome(entry) {
    if (entry.payload?.channel === 'outlook-draft' && entry.payload?.event === 'succeeded') {
      return 'Outlook draft saved in Outlook Drafts. Nothing was sent.';
    }
    if (entry.payload?.channel === 'outlook-draft' && entry.payload?.event === 'failed') {
      return `Outlook draft was not created (${entry.payload?.code || 'CREATE_FAILED'}).`;
    }
    if (entry.payload?.channel === 'teams' && entry.payload?.event === 'succeeded') {
      return 'Teams message sent with a matching receipt.';
    }
    if (entry.payload?.channel === 'teams' && entry.payload?.code === 'CANCELLED') {
      return 'Teams send cancelled before dispatch. No request was dispatched.';
    }
    if (entry.payload?.channel === 'teams' && entry.payload?.code === 'SEND_UNCONFIRMED') {
      return 'Teams send could not be confirmed. Check Teams before trying again.';
    }
    return entry.summary || 'Action proposal updated';
  }

  function openSource(itemId) {
    void navigateToRadarItem(itemId);
  }
</script>

<section class="command-view history-command">
  <header class="command-view__heading">
    <div><span>HISTORY</span><h1>Source timeline & audit</h1></div>
    <label>Context
      <select bind:value={selectedItemId}><option value="all">Choose a source object</option>{#each $items as item}<option value={item.id}>{item.title}</option>{/each}</select>
    </label>
  </header>

  {#if selectedItem}
    <section class="history-context">
      <header><div><span>{selectedItem.sourceType || 'Signal'}</span><h2>{selectedItem.title}</h2></div><strong>{contextual.length} events</strong></header>
      <div class="history-table" role="table" aria-label="Contextual timeline">
        <div class="history-row history-row--head" role="row"><span role="columnheader">When</span><span role="columnheader">Actor</span><span role="columnheader">Object</span><span role="columnheader">Event</span><span role="columnheader">Source</span><span role="columnheader">Outcome</span></div>
        {#each contextual as entry}<div class="history-row" role="row"><time role="cell" data-label="When">{safeDate(entry.at, 'Unknown')}</time><strong role="cell" data-label="Actor">{entry.actor}</strong><span role="cell" data-label="Object">{entry.object}</span><span role="cell" data-label="Event">{entry.event}</span><span role="cell" data-label="Source">{entry.source}</span><p role="cell" data-label="Outcome">{entry.outcome}</p></div>
        {:else}<p class="command-empty">No contextual events.</p>{/each}
      </div>
    </section>
  {/if}

  <section class="history-global">
    <header><div><span>SECONDARY AUDIT</span><h2>Global events</h2></div><label>Event <select bind:value={kind}><option value="all">All</option>{#each eventKinds as value}<option value={value}>{value}</option>{/each}</select></label></header>
    <div class="history-table" role="table" aria-label="Global audit">
      <div class="history-row history-row--head" role="row"><span role="columnheader">When</span><span role="columnheader">Actor</span><span role="columnheader">Object</span><span role="columnheader">Event</span><span role="columnheader">Source</span><span role="columnheader">Outcome</span></div>
      {#each globalEntries as entry}<div class="history-row" role="row"><time role="cell" data-label="When">{safeDate(entry.at, 'Unknown')}</time><strong role="cell" data-label="Actor">{entry.actor}</strong><span role="cell" data-label="Object">{#if entry.itemId}<button type="button" class="history-source-link" data-testid="history-source-link" on:click={() => openSource(entry.itemId)}>{entry.object}</button>{:else}{entry.object}{/if}</span><span role="cell" data-label="Event">{entry.event}</span><span role="cell" data-label="Source">{entry.source}</span><p role="cell" data-label="Outcome">{entry.outcome}</p></div>
      {:else}<p class="command-empty">No audit entries match.</p>{/each}
    </div>
  </section>
</section>
