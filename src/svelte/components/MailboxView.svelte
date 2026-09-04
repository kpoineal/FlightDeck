<script>
  import { get } from 'svelte/store';
  import { items, coldItems, deletedItemIds } from '../lib/stores.js';
  import { LIFECYCLE_LABELS, LIFECYCLE_STATUSES } from '../lib/constants.js';
  import { safeDate } from '../lib/utils.js';
  import {
    getMailboxThreads,
    isMailboxUnread,
    latestMailboxUpdate,
    mailboxActivityAt,
    mailboxWorkStatus,
    mailboxWorkStatusClass,
  } from '../lib/mailbox.js';
  import {
    markItemRead,
    deleteItem,
    setItemLifecycle,
    setItemScheduleField,
    setItemSeverity,
  } from '../lib/item-actions.js';
  import { ITEM_DELETION_CONFIRMATION, itemDeletionFailureMessage } from '../lib/item-deletion-ui.js';
  import { filterDeletedItems, reconcileHydratedItems } from '../lib/models/item.js';
  import { nextItemSelectionAfterRemoval } from '../lib/radar-selection.js';
  import { runItemCheck } from '../lib/monitor-engine.js';
  import { savePersistentState } from '../lib/persistence.js';
  import ActivityTimeline from './ActivityTimeline.svelte';
  import ConfirmModal from './ConfirmModal.svelte';
  import ScheduleControls from './ScheduleControls.svelte';

  const SEGMENTS = [
    { id: 'inbox', label: 'Inbox' },
    { id: 'monitored', label: 'Monitored' },
    { id: 'all', label: 'All' },
    { id: 'archived', label: 'Archived' },
  ];

  let segment = $state('inbox');
  let selectedBySegment = $state({ inbox: null, monitored: null, all: null, archived: null });
  let mobileDetailOpen = $state(false);
  let mailboxView;
  let originatingRow = null;
  let deleteRequest = $state(null);
  let deleteState = $state({ status: 'idle', message: '' });

  let projectedItems = $derived(filterDeletedItems([
    ...$items,
    ...$coldItems.filter((coldItem) => !$items.some((item) => item.id === coldItem.id)),
  ], $deletedItemIds));
  let threads = $derived(getMailboxThreads(projectedItems, segment));
  let segmentCounts = $derived(Object.fromEntries(
    SEGMENTS.map(({ id }) => [id, getMailboxThreads(projectedItems, id).length])
  ));
  let selectedId = $derived(selectedBySegment[segment] || threads[0]?.id || null);
  let selectedItem = $derived(projectedItems.find((item) => item.id === selectedId) || null);
  let selectedEntries = $derived(
    (Array.isArray(selectedItem?.updateHistory) ? [...selectedItem.updateHistory] : [])
      .sort((left, right) => Date.parse(right?.timestamp || '') - Date.parse(left?.timestamp || ''))
  );
  let selectedIsStored = $derived(selectedItem && $items.some((item) => item.id === selectedItem.id));

  $effect(() => {
    if (segment !== 'archived' || !window.workiq || typeof window.workiq.getColdItems !== 'function') return;
    window.workiq.getColdItems().then((result) => {
      if (Array.isArray(result)) {
        coldItems.update((current) => reconcileHydratedItems(current, result, $deletedItemIds));
      }
    }).catch(() => {});
  });

  function setSegment(nextSegment) {
    segment = nextSegment;
    mobileDetailOpen = false;
    originatingRow = null;
  }

  function isMobileViewport() {
    return window.matchMedia?.('(max-width: 860px)').matches === true;
  }

  function isVisible(element) {
    return Boolean(element?.isConnected && element.getClientRects().length);
  }

  function focusMobileDetail() {
    requestAnimationFrame(() => {
      if (!isMobileViewport()) return;
      const target = mailboxView?.querySelector('.mailbox-back');
      if (isVisible(target)) target.focus();
    });
  }

  function closeMobileDetail() {
    mobileDetailOpen = false;
    requestAnimationFrame(() => {
      if (!isMobileViewport()) return;
      const rows = [...(mailboxView?.querySelectorAll('.mailbox-thread-row') || [])];
      const selectedRow = rows.find((row) => row.dataset.threadId === selectedId);
      const target = isVisible(originatingRow)
        ? originatingRow
        : isVisible(selectedRow)
          ? selectedRow
          : rows.find(isVisible);
      target?.focus();
      originatingRow = null;
    });
  }

  function selectThread(item, { markRead = false, openDetail = false, originRow = null } = {}) {
    selectedBySegment[segment] = item.id;
    if (openDetail) {
      originatingRow = originRow;
      mobileDetailOpen = true;
      focusMobileDetail();
    }
    if (markRead && isMailboxUnread(item)) markItemRead(item.id);
  }

  function handleRowKeydown(event, index) {
    let nextIndex = index;
    if (event.key === 'ArrowDown') nextIndex = Math.min(threads.length - 1, index + 1);
    else if (event.key === 'ArrowUp') nextIndex = Math.max(0, index - 1);
    else if (event.key === 'Home') nextIndex = 0;
    else if (event.key === 'End') nextIndex = threads.length - 1;
    else return;

    event.preventDefault();
    const nextItem = threads[nextIndex];
    if (!nextItem) return;
    selectThread(nextItem);
    const rows = event.currentTarget.parentElement?.querySelectorAll('.mailbox-thread-row');
    requestAnimationFrame(() => rows?.[nextIndex]?.focus());
  }

  function previewText(item) {
    const update = latestMailboxUpdate(item);
    if (update?.summary) return update.summary;
    if (Array.isArray(update?.changes) && update.changes.length) return update.changes.join(' · ');
    return item.summary || item.reason || 'No thread activity yet';
  }

  function previewSource(item) {
    return latestMailboxUpdate(item)?.sourceType || item.sourceType || 'Signal';
  }

  function previewTime(item) {
    return safeDate(mailboxActivityAt(item), 'No activity');
  }

  async function handleRunNow(data) {
    const item = get(items).find((entry) => entry.id === data.itemId);
    if (!item) return;
    try {
      await runItemCheck(item);
      savePersistentState();
    } catch (_) {}
  }

  function openPopout() {
    if (selectedItem && window.workiq && typeof window.workiq.openTrackerPopout === 'function') {
      window.workiq.openTrackerPopout(selectedItem.id);
    }
  }

  function requestDeleteSelected(event) {
    if (!selectedItem || deleteState.status === 'deleting') return;
    deleteState = { status: 'idle', message: '' };
    deleteRequest = {
      id: selectedItem.id,
      title: selectedItem.title || 'Untitled item',
      replacementId: nextItemSelectionAfterRemoval(threads, selectedItem.id),
      returnFocus: event.currentTarget,
    };
  }

  async function confirmDeleteSelected() {
    const request = deleteRequest;
    if (!request || deleteState.status === 'deleting') return;
    deleteRequest = null;
    deleteState = { status: 'deleting', message: '' };
    const result = await deleteItem(request.id);
    if (result.ok) {
      const replacementId = threads.some((thread) => thread.id === request.replacementId)
        ? request.replacementId
        : null;
      selectedBySegment = { ...selectedBySegment, [segment]: replacementId };
      mobileDetailOpen = Boolean(replacementId) && mobileDetailOpen;
      originatingRow = null;
      deleteState = { status: 'idle', message: '' };
      requestAnimationFrame(() => {
        const target = replacementId
          ? mailboxView?.querySelector('.mailbox-detail-title h3')
          : mailboxView?.querySelector('.mailbox-segments button[aria-pressed="true"]');
        target?.focus();
      });
      return;
    }

    selectedBySegment = { ...selectedBySegment, [segment]: request.id };
    deleteState = { status: 'error', message: itemDeletionFailureMessage(result.code) };
    requestAnimationFrame(() => mailboxView?.querySelector('.mailbox-detail-title h3')?.focus());
  }

</script>

<section class="mode-view active mailbox-view" aria-label="Mailbox" bind:this={mailboxView}>
  <div class="mailbox-toolbar">
    <div>
      <h2>Mailbox</h2>
      <p>Monitored work, organized as threads</p>
    </div>
    <div class="mailbox-toolbar-actions">
      <div class="mailbox-segments" aria-label="Mailbox segments">
        {#each SEGMENTS as option}
          <button type="button" class:active={segment === option.id}
            aria-pressed={segment === option.id}
            on:click={() => setSegment(option.id)}>
            <span>{option.label}</span>
            <span class="mailbox-count">{segmentCounts[option.id]}</span>
          </button>
        {/each}
      </div>
    </div>
  </div>

  <div class="mailbox-workspace">
    <div class="mailbox-list-pane" class:mailbox-mobile-hidden={mobileDetailOpen}>
      <div class="mailbox-list-heading">
        <strong>{SEGMENTS.find((option) => option.id === segment)?.label}</strong>
        <span>{threads.length} {threads.length === 1 ? 'thread' : 'threads'}</span>
      </div>
      <div class="mailbox-thread-list" aria-label="Threads">
        {#if threads.length === 0}
          <div class="mailbox-empty">No threads in this segment.</div>
        {:else}
          {#each threads as item, index (item.id)}
            {@const unread = isMailboxUnread(item)}
            <button type="button"
              class="mailbox-thread-row"
              data-thread-id={item.id}
              class:selected={selectedId === item.id}
              class:unread
              aria-current={selectedId === item.id ? 'true' : undefined}
              on:click={(event) => selectThread(item, { markRead: true, openDetail: true, originRow: event.currentTarget })}
              on:keydown={(event) => handleRowKeydown(event, index)}>
              <span class="mailbox-row-topline">
                <span class="mailbox-unread-dot" aria-label={unread ? 'Unread' : 'Read'}></span>
                <strong>{item.title || 'Untitled item'}</strong>
                <time title={previewTime(item)}>{previewTime(item)}</time>
              </span>
              <span class="mailbox-row-preview">{previewText(item)}</span>
              <span class="mailbox-row-meta">
                <span>{previewSource(item)}</span>
                <span class="mailbox-status mailbox-status-{mailboxWorkStatusClass(item)}" title={`Work status: ${mailboxWorkStatus(item)}`}>{mailboxWorkStatus(item)}</span>
                <span class="mailbox-severity mailbox-severity-{(item.severity || 'observe').toLowerCase()}" title={`Criticality: ${item.severity || 'Observe'}`}>{item.severity || 'Observe'}</span>
              </span>
            </button>
          {/each}
        {/if}
      </div>
    </div>

    <div class="mailbox-detail-pane" class:mailbox-mobile-hidden={!mobileDetailOpen}>
      {#if selectedItem}
        <header class="mailbox-detail-header">
          <button type="button" class="mailbox-back" on:click={closeMobileDetail}>Back</button>
          <div class="mailbox-detail-title">
            <span>{selectedItem.sourceType || 'Signal'}</span>
            <h3 tabindex="-1">{selectedItem.title || 'Untitled item'}</h3>
            <p>{selectedItem.owner || 'You'} · Last activity {previewTime(selectedItem)}</p>
          </div>
          <div class="mailbox-detail-actions">
            {#if isMailboxUnread(selectedItem) && selectedIsStored}
              <button type="button" class="small-btn primary" on:click={() => markItemRead(selectedItem.id)}>Mark read</button>
            {/if}
            <button type="button" class="small-btn" on:click={openPopout}>Open window</button>
            {#if selectedIsStored && selectedItem.lifecycleStatus !== 'archived'}
              <button type="button" class="small-btn" data-testid="mailbox-archive"
                on:click={() => setItemLifecycle(selectedItem.id, 'archived')}>Archive thread</button>
            {/if}
            <button type="button" class="small-btn warn" data-testid="mailbox-delete"
              disabled={deleteState.status === 'deleting'} on:click={requestDeleteSelected}>Delete card...</button>
          </div>
        </header>

        {#if deleteState.status === 'error'}
          <p class="mailbox-delete-error" role="alert" data-testid="mailbox-delete-error">{deleteState.message}</p>
        {/if}

        <div class="mailbox-control-strip">
          <label>
            <span>Severity</span>
            <select value={selectedItem.severity} disabled={!selectedIsStored}
              on:change={(event) => setItemSeverity(selectedItem.id, event.target.value)}>
              <option value="Critical">Critical</option>
              <option value="Elevated">Elevated</option>
              <option value="Observe">Observe</option>
            </select>
          </label>
          <label>
            <span>Status</span>
            <select value={selectedItem.lifecycleStatus} disabled={!selectedIsStored}
              on:change={(event) => setItemLifecycle(selectedItem.id, event.target.value)}>
              {#each LIFECYCLE_STATUSES as status}
                <option value={status}>{LIFECYCLE_LABELS[status]}</option>
              {/each}
            </select>
          </label>
          <span class="mailbox-current-status">{selectedItem.status || LIFECYCLE_LABELS[selectedItem.lifecycleStatus]}</span>
        </div>

        {#if selectedIsStored && selectedItem.lifecycleStatus !== 'archived'}
          <details class="mailbox-monitoring">
            <summary>Monitoring schedule</summary>
            <ScheduleControls item={selectedItem}
              onchange={(data) => setItemScheduleField(data.itemId, data.field, data.value)}
              onrunnow={handleRunNow} />
          </details>
        {/if}

        <div class="mailbox-thread-heading">
          <h4>Thread</h4>
          <span>{selectedEntries.length} {selectedEntries.length === 1 ? 'event' : 'events'}</span>
        </div>
        <div class="mailbox-timeline">
          {#if selectedEntries.length}
            <ActivityTimeline entries={selectedEntries} item={selectedItem} maxVisible={0} />
          {:else}
            <div class="mailbox-empty">No activity has been recorded for this thread.</div>
          {/if}
        </div>
      {:else}
        <div class="mailbox-empty mailbox-empty-detail">Select a thread to view its activity.</div>
      {/if}
    </div>
  </div>
</section>

<ConfirmModal open={Boolean(deleteRequest)}
  title={ITEM_DELETION_CONFIRMATION.title}
  summary={ITEM_DELETION_CONFIRMATION.summary}
  targets={deleteRequest?.title || ''}
  confirmLabel={ITEM_DELETION_CONFIRMATION.confirmLabel}
  returnFocus={deleteRequest?.returnFocus || null}
  onconfirm={confirmDeleteSelected}
  oncancel={() => { deleteRequest = null; }} />
