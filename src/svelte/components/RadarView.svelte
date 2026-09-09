<script>
  import { get } from 'svelte/store';
  import {
    actionProposals,
    openActionsQueue,
    coldItems,
    deletedItemIds,
    highlightedItemId,
    connected,
    isDemo,
    items,
    scanners,
    selectedProposalId,
  } from '../lib/stores.js';
  import {
    compareInboxThreads,
    compareMailboxThreads,
    isMailboxActive,
    isMailboxArchived,
    isMailboxSnoozed,
    isMailboxUnread,
    isRadarPriority,
    latestMailboxUpdate,
    mailboxActivityAt,
    mailboxWorkStatus,
    mailboxWorkStatusClass,
  } from '../lib/mailbox.js';
  import { matchesInboxFilters } from '../lib/inbox-filters.js';
  import {
    createActionEventId,
    deleteItem,
    markItemRead,
    recordActionEvent,
    setItemField,
    setItemLifecycle,
    setItemSeverity,
  } from '../lib/item-actions.js';
  import {
    adaptEmailProposalsToActionQueue,
    buildProposalSynthesisContext,
    normalizeProposalSynthesisResult,
  } from '../lib/proposal-synthesis.js';
  import { addHistory } from '../lib/actions.js';
  import { LIFECYCLE_LABELS, LIFECYCLE_STATUSES } from '../lib/constants.js';
  import { collectItemEvidenceLinks, filterDeletedItems, normalizeItem } from '../lib/models/item.js';
  import { computeScannerNextRunAt, normalizeScannerDefinition } from '../lib/models/scanner.js';
  import { savePersistentState } from '../lib/persistence.js';
  import { executeScannerDeletion, previewScannerDeletion } from '../lib/scanner-actions.js';
  import { runScanner } from '../lib/scanner-engine.js';
  import { runItemCheck } from '../lib/monitor-engine.js';
  import { logError } from '../lib/logger.js';
  import { safeDate } from '../lib/utils.js';
  import { nextItemSelectionAfterRemoval, reconcileRadarSelection } from '../lib/radar-selection.js';
  import { hydrateRadarColdItems, resolveRadarItem } from '../lib/radar-navigation.js';
  import { ITEM_DELETION_CONFIRMATION, itemDeletionFailureMessage } from '../lib/item-deletion-ui.js';
  import ActivityTimeline from './ActivityTimeline.svelte';
  import AddTaskModal from './AddTaskModal.svelte';
  import ConfirmModal from './ConfirmModal.svelte';
  import ScannerDeletionModal from './ScannerDeletionModal.svelte';
  import ScannerSettingsModal from './ScannerSettingsModal.svelte';
  import ScheduleControls from './ScheduleControls.svelte';
  import { showToast } from './Toast.svelte';

  const VIEWS = [
    { id: 'inbox', label: 'Inbox', predicate: (item, at) => isMailboxActive(item) && !isMailboxSnoozed(item, at) },
    { id: 'priority', label: 'Priority', predicate: isRadarPriority },
    { id: 'monitored', label: 'Monitored', predicate: (item, at) => isMailboxActive(item) && !isMailboxSnoozed(item, at) && item.monitorEnabled },
    { id: 'snoozed', label: 'Snoozed', predicate: (item, at) => isMailboxActive(item) && isMailboxSnoozed(item, at) },
    { id: 'completed', label: 'Completed', predicate: (item) => item.lifecycleStatus === 'complete' },
    { id: 'archived', label: 'Archive', predicate: (item) => isMailboxArchived(item) },
  ];

  let smartView = $state('inbox');
  let scannerId = $state('all');
  let query = $state('');
  let sort = $state('recent');
  let quickFilter = $state('');
  let refineFilters = $state({});
  let selectedId = $state(null);
  let pendingNavigationId = $state(null);
  let mobileStep = $state('filters');
  let viewRoot = $state(null);
  let originatingThread = null;
  let now = $state(Date.now());
  let scannerModalOpen = $state(false);
  let taskModalOpen = $state(false);
  let editingScanner = $state(null);
  let scannerSettingsFocusOrigin = null;
  let scannerDeletion = $state({
    open: false,
    preview: null,
    status: 'idle',
    message: '',
    returnFocus: null,
  });
  let synthesisState = $state({ threadId: null, requestedChannel: null, status: 'idle', result: null, error: '' });
  let teamsDraft = $state(null);
  let teamsCopyStatus = $state('');
  let teamsSendState = $state({ status: 'idle', message: '' });
  let deleteRequest = $state(null);
  let deleteState = $state({ status: 'idle', message: '' });

  let projected = $derived.by(() => {
    const hotItemIds = new Set($items.map((item) => item.id));
    return filterDeletedItems([
      ...$items,
      ...$coldItems.filter((cold) => !hotItemIds.has(cold.id)),
    ], $deletedItemIds);
  });
  let projectionIndex = $derived.by(() => {
    const viewCounts = new Map(VIEWS.map((view) => [view.id, 0]));
    const scannerCounts = new Map();
    const titleGroups = new Map();

    for (const item of projected) {
      for (const view of VIEWS) {
        if (view.predicate(item, now)) viewCounts.set(view.id, viewCounts.get(view.id) + 1);
      }

      scannerCounts.set(item.scannerId, (scannerCounts.get(item.scannerId) || 0) + 1);
      const titleGroup = item.title?.split(/\s+[—-]\s+/)[0];
      const group = titleGroups.get(titleGroup);
      if (group) group.push(item);
      else titleGroups.set(titleGroup, [item]);
    }

    return { viewCounts, scannerCounts, titleGroups };
  });
  let threads = $derived.by(() => {
    const view = VIEWS.find((entry) => entry.id === smartView) || VIEWS[0];
    const needle = query.trim().toLowerCase();
    const inboxFilters = {
      quickFilter,
      facets: refineFilters,
    };
    const filtered = [];
    for (const item of projected) {
      if (!view.predicate(item, now)) continue;
      if (!(scannerId === 'all' || item.scannerId === scannerId)) continue;
      if (needle && ![item.title, item.summary, item.reason, item.owner, ...(item.counterparties || [])]
        .some((value) => String(value || '').toLowerCase().includes(needle))) continue;
      if (!matchesInboxFilters(item, inboxFilters, { now })) continue;
      filtered.push(item);
    }
    if (sort === 'recent') return filtered.sort(compareInboxThreads);
    return filtered.sort(compareMailboxThreads);
  });
  let firstThreadId = $derived(threads.at(0)?.id || null);
  let activeFilters = $derived.by(() => {
    const filters = [];
    if (quickFilter) filters.push({ facet: 'quick', value: quickFilter, label: filterLabel(quickFilter) });
    for (const [facet, values] of Object.entries(refineFilters)) {
      for (const value of Array.isArray(values) ? values : []) {
        filters.push({ facet, value, label: `${facetLabel(facet)}: ${filterLabel(value)}` });
      }
    }
    return filters;
  });
  let selected = $derived(threads.find((item) => item.id === selectedId) || null);
  let timeline = $derived([...(selected?.updateHistory || [])].sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0)));
  let sourceLinks = $derived(selected ? collectItemEvidenceLinks(selected) : []);
  let duplicates = $derived(selected
    ? (projectionIndex.titleGroups.get(selected.title?.split(/\s+[—-]\s+/)[0]) || [])
      .filter((item) => item.id !== selected.id)
    : []);

  $effect(() => {
    const preserveId = pendingNavigationId && projected.some((item) => item.id === pendingNavigationId)
      ? pendingNavigationId
      : null;
    const next = reconcileRadarSelection({ selectedId, mobileStep, smartView, scannerId, query }, threads, { preserveId });
    if (next.selectedId !== selectedId || next.mobileStep !== mobileStep) {
      selectedId = next.selectedId;
      mobileStep = next.mobileStep;
    }
  });

  $effect(() => {
    const timer = setInterval(() => { now = Date.now(); }, 60_000);
    return () => clearInterval(timer);
  });

  $effect(() => {
    const requestedId = $highlightedItemId;
    const highlighted = projected.find((item) => item.id === requestedId);
    if (requestedId && !highlighted) {
      resolveRadarItem(requestedId).then((resolved) => {
        if (!resolved && $highlightedItemId === requestedId) highlightedItemId.set(null);
      });
      return;
    }
    if (highlighted) {
      pendingNavigationId = highlighted.id;
      smartView = isMailboxArchived(highlighted)
        ? 'archived'
        : highlighted.lifecycleStatus === 'complete'
          ? 'completed'
        : isMailboxSnoozed(highlighted, now)
          ? 'snoozed'
          : 'inbox';
      scannerId = 'all';
      query = '';
      selectedId = highlighted.id;
      mobileStep = 'detail';
      requestAnimationFrame(() => {
        if (pendingNavigationId !== highlighted.id || selectedId !== highlighted.id) return;
        const row = viewRoot?.querySelector(`[data-thread-id="${CSS.escape(highlighted.id)}"]`);
        if (row?.getClientRects().length) {
          row.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
          row.focus({ preventScroll: true });
        } else {
          viewRoot?.querySelector('.radar-thread-detail h2')?.focus();
        }
        pendingNavigationId = null;
      });
      highlightedItemId.set(null);
    }
  });

  $effect(() => {
    if (!['completed', 'archived'].includes(smartView)) return;
    if (pendingNavigationId && $coldItems.some((item) => item.id === pendingNavigationId)) return;
    void hydrateRadarColdItems();
  });

  function selectThread(item, origin, { markRead = false } = {}) {
    selectedId = item.id;
    originatingThread = origin;
    mobileStep = 'detail';
    requestAnimationFrame(() => viewRoot?.querySelector('.radar-thread-detail h2')?.focus());
    const readStateDefinesProjection = ['unread', 'new', 'updated'].includes(quickFilter)
      || Boolean(refineFilters.read?.length);
    markRead = markRead && !readStateDefinesProjection;
    if (markRead && isMailboxUnread(item)) markItemRead(item.id);
  }

  function handleThreadKeydown(event, item) {
    if (!['ArrowUp', 'ArrowDown', 'Home', 'End'].includes(event.key)) return;
    if (event.target?.matches?.('input, select, textarea, [contenteditable="true"]')) return;
    const currentIndex = threads.findIndex((thread) => thread.id === item.id);
    if (currentIndex < 0) return;
    event.preventDefault();
    const targetIndex = event.key === 'Home' ? 0
      : event.key === 'End' ? threads.length - 1
      : event.key === 'ArrowUp' ? Math.max(0, currentIndex - 1)
      : Math.min(threads.length - 1, currentIndex + 1);
    const target = threads[targetIndex];
    if (!target) return;
    selectedId = target.id;
    originatingThread = event.currentTarget;
    requestAnimationFrame(() => {
      const row = viewRoot?.querySelector(`[data-thread-id="${CSS.escape(target.id)}"]`);
      row?.focus({ preventScroll: true });
      row?.scrollIntoView({ block: 'nearest' });
    });
  }

  function onkeydown(node, item) {
    let currentItem = item;
    const handle = (event) => handleThreadKeydown(event, currentItem);
    node.addEventListener('keydown', handle);
    return {
      update(nextItem) {
        currentItem = nextItem;
      },
      destroy() {
        node.removeEventListener('keydown', handle);
      },
    };
  }

  function filterLabel(value) {
    const labels = {
      unread: 'Unread', new: 'NEW', updated: 'UPDATED', critical: 'Critical', blocked: 'Blocked',
      'due-soon': 'Due soon', 'in-progress': 'In progress', complete: 'Complete', archived: 'Archived',
      enabled: 'Enabled', paused: 'Paused', disabled: 'Disabled', overdue: 'Overdue', later: 'Later',
      none: 'None', email: 'Email', chat: 'Teams', meeting: 'Meeting', doc: 'Document',
      today: 'Today', 'last-7-days': 'Last 7 days', 'last-30-days': 'Last 30 days', older: 'Older',
      'no-activity': 'No activity', unassigned: 'Unassigned', read: 'Read', waiting: 'Waiting', unknown: 'Unknown',
    };
    return labels[value] || value;
  }

  function facetLabel(facet) {
    return { severity: 'Severity', lifecycle: 'Lifecycle', scanner: 'Scanner', read: 'Read state', monitoring: 'Monitoring', due: 'Due', signal: 'Signal', 'activity-age': 'Activity' }[facet] || facet;
  }

  function toggleQuickFilter(value) {
    quickFilter = quickFilter === value ? '' : value;
  }

  function toggleRefineFilter(facet, value, checked) {
    const current = Array.isArray(refineFilters[facet]) ? refineFilters[facet] : [];
    const values = checked ? [...new Set([...current, value])] : current.filter((entry) => entry !== value);
    refineFilters = { ...refineFilters, [facet]: values };
  }

  function removeActiveFilter(filter) {
    if (filter.facet === 'quick') {
      quickFilter = '';
      return;
    }
    toggleRefineFilter(filter.facet, filter.value, false);
  }

  function chooseView(id) {
    smartView = id;
    selectedId = null;
    originatingThread = null;
    mobileStep = 'list';
  }

  function returnToThreads() {
    const selectedThreadId = selected?.id;
    mobileStep = 'list';
    requestAnimationFrame(() => {
      const selectedThread = viewRoot?.querySelector(`[data-thread-id="${CSS.escape(selectedThreadId || '')}"]`);
      const target = originatingThread?.isConnected ? originatingThread : selectedThread;
      target?.focus();
      originatingThread = null;
    });
  }

  function inlineProposalId(prefix, itemId, timestamp) {
    const safeItemId = String(itemId || 'local').replace(/[^A-Za-z0-9._:-]/g, '_').slice(0, 80);
    return `${prefix}:${safeItemId}:${Date.parse(timestamp) || Date.now()}`;
  }

  async function recordRadarActionEvent({ proposalId, itemId, event, timestamp, channel, target, outcome, verification, code, attempt = 0 }) {
    const eventId = createActionEventId({ proposalId, event, timestamp, attempt });
    if (!eventId) return false;
    return recordActionEvent({
      eventId,
      itemId,
      proposalId,
      event,
      timestamp,
      channel,
      target,
      outcome,
      verification,
      code,
    });
  }

  async function draftMessage(requestedChannel, initiator = null) {
    if (!selected || synthesisState.status === 'generating') return;
    const sourceItem = selected;
    const context = buildProposalSynthesisContext(sourceItem, { requestedChannel });
    if (!context || typeof window.workiq?.proposeThreadActions !== 'function') {
      synthesisState = {
        threadId: sourceItem.id,
        requestedChannel,
        status: 'error',
        result: null,
        error: 'Proposal synthesis is unavailable. Try again after reconnecting WorkIQ.',
      };
      return;
    }

    teamsDraft = null;
    teamsCopyStatus = '';
    teamsSendState = { status: 'idle', message: '' };
    synthesisState = { threadId: sourceItem.id, requestedChannel, status: 'generating', result: null, error: '' };
    try {
      const response = await window.workiq.proposeThreadActions(context);
      if (selected?.id !== sourceItem.id) return;
      const result = response?.ok === true ? normalizeProposalSynthesisResult(response.result) : null;
      if (!result) {
        synthesisState = {
          threadId: sourceItem.id,
          requestedChannel,
          status: 'error',
          result: null,
          error: synthesisError(response?.code),
        };
        return;
      }

      const matchingProposals = result.proposals.filter((proposal) => proposal.channel === requestedChannel);
      const channelResult = { ...result, proposals: matchingProposals };
      if (requestedChannel === 'email') {
        const existing = get(actionProposals);
        const created = adaptEmailProposalsToActionQueue(sourceItem, channelResult, existing);
        const matchingExisting = existing.find((entry) =>
          entry.sourceItemId === sourceItem.id
          && entry.channel === 'outlook-draft'
          && matchingProposals.some((proposal) =>
            entry.target === (proposal.target.address || proposal.target.displayName)
            && entry.sourceTitle === proposal.payload.subject
            && entry.content === proposal.payload.body
          )
        );
        if (created.length) {
          actionProposals.set([...created, ...existing]);
          for (const createdProposal of created) {
            await recordRadarActionEvent({
              proposalId: createdProposal.id,
              itemId: sourceItem.id,
              event: 'proposal-created',
              timestamp: createdProposal.createdAt,
              channel: createdProposal.channel,
              target: createdProposal.target,
              outcome: 'pending',
              verification: 'not-applicable',
            });
          }
        }
        const emailProposal = created[0] || matchingExisting;
        if (emailProposal) {
          selectedProposalId.set(emailProposal.id);
          openActionsQueue(initiator);
        }
      } else {
        const proposal = matchingProposals[0];
        if (proposal) {
          const createdAt = new Date().toISOString();
          teamsDraft = {
            proposalId: inlineProposalId('teams', sourceItem.id, createdAt),
            sourceItemId: sourceItem.id,
            createdAt,
            attempt: 0,
            target: proposal.needsTargetResolution ? '' : proposal.target.displayName,
            message: proposal.payload.message,
            why: result.why,
            risk: proposal.risk,
            reviewNote: proposal.reviewNote,
            needsTargetResolution: proposal.needsTargetResolution,
          };
        }
      }
      synthesisState = { threadId: sourceItem.id, requestedChannel, status: 'ready', result: channelResult, error: '' };
    } catch (_) {
      if (selected?.id === sourceItem.id) {
        synthesisState = {
          threadId: sourceItem.id,
          requestedChannel,
          status: 'error',
          result: null,
          error: 'Could not generate a grounded proposal. Try again.',
        };
      }
    }
  }

  async function copyTeamsDraft() {
    if (!teamsDraft?.message) return;
    try {
      await navigator.clipboard.writeText(teamsDraft.message);
      teamsCopyStatus = 'Copied';
    } catch (_) {
      teamsCopyStatus = 'Copy unavailable';
    }
  }

  async function sendTeamsDraft() {
    if (!teamsDraft || !teamsDraft.target.trim() || teamsSendState.status === 'sending') return;
    const target = teamsDraft.target.trim();
    const message = teamsDraft.message.trim();
    if (!message) {
      teamsSendState = { status: 'error', message: 'Enter a message before sending.' };
      return;
    }
    if (typeof window.workiq?.sendTeamsMessage !== 'function') {
      teamsSendState = { status: 'error', message: 'Teams sending is unavailable. Try again after reconnecting WorkIQ.' };
      return;
    }

    const attempt = (teamsDraft.attempt || 0) + 1;
    const attemptedAt = new Date().toISOString();
    teamsDraft = { ...teamsDraft, target, attempt };
    teamsSendState = { status: 'sending', message: '' };
    try {
      const response = await window.workiq.sendTeamsMessage({
        targetDisplayName: target,
        message,
      });
      if (response?.ok === true && response.action === 'teams-message-sent') {
        teamsSendState = { status: 'sent', message: 'Message sent. Teams returned a matching send receipt.' };
        await recordRadarActionEvent({
          proposalId: teamsDraft.proposalId,
          itemId: teamsDraft.sourceItemId,
          event: 'succeeded',
          timestamp: attemptedAt,
          channel: 'teams',
          target,
          outcome: 'succeeded',
          verification: 'runtime-backend-confirmed',
          code: 'SEND_CONFIRMED',
          attempt,
        });
        return;
      }
      const code = safeTeamsCode(response?.code);
      if (code === 'CANCELLED') {
        teamsSendState = { status: 'idle', message: 'Send cancelled. No request was dispatched. Your draft was not changed.' };
        await recordRadarActionEvent({
          proposalId: teamsDraft.proposalId,
          itemId: teamsDraft.sourceItemId,
          event: 'cancelled',
          timestamp: attemptedAt,
          channel: 'teams',
          target,
          outcome: 'cancelled',
          verification: 'not-applicable',
          code,
          attempt,
        });
      } else {
        teamsSendState = { status: 'error', message: teamsSendError(code) };
        await recordRadarActionEvent({
          proposalId: teamsDraft.proposalId,
          itemId: teamsDraft.sourceItemId,
          event: 'failed',
          timestamp: attemptedAt,
          channel: 'teams',
          target,
          outcome: code === 'SEND_UNCONFIRMED' ? 'unverified' : 'failed',
          verification: code === 'SEND_UNCONFIRMED' ? 'unverified' : 'not-applicable',
          code,
          attempt,
        });
      }
    } catch (_) {
      teamsSendState = { status: 'error', message: 'Delivery could not be confirmed. Check Teams before trying again.' };
      await recordRadarActionEvent({
        proposalId: teamsDraft.proposalId,
        itemId: teamsDraft.sourceItemId,
        event: 'failed',
        timestamp: attemptedAt,
        channel: 'teams',
        target,
        outcome: 'unverified',
        verification: 'unverified',
        code: 'SEND_UNCONFIRMED',
        attempt,
      });
    }
  }

  function safeTeamsCode(code) {
    const normalized = String(code || '').trim().toUpperCase();
    return /^[A-Z][A-Z0-9_]{0,63}$/.test(normalized) ? normalized : 'SEND_UNCONFIRMED';
  }

  function evidenceTypeLabel(type) {
    const labels = { email: 'Email', chat: 'Teams', meeting: 'Meeting', doc: 'Document', source: 'Source' };
    return labels[String(type || '').toLowerCase()] || 'Source';
  }

  function openEvidenceLink(event, url) {
    if (typeof window.workiq?.openExternal !== 'function') return;
    event.preventDefault();
    window.workiq.openExternal(url);
  }

  function teamsSendError(code) {
    if (code === 'AUTH_REQUIRED') return 'WorkIQ sign-in is required before sending.';
    if (code === 'TARGET_NOT_FOUND') return 'No existing one-to-one Teams chat was found for this person.';
    if (code === 'TARGET_AMBIGUOUS') return 'More than one matching Teams chat was found. The message was not sent.';
    if (code === 'SEND_UNCONFIRMED') return 'Delivery could not be confirmed. Check Teams before trying again.';
    if (code === 'INVALID_MESSAGE') return 'Review the recipient and message before retrying.';
    if (code === 'SEND_FAILED') return 'Teams reported that the message was not sent. Review the draft before trying again.';
    if (code === 'UNSUPPORTED') return 'Teams sending is unavailable through the connected WorkIQ service.';
    if (code === 'RESOLUTION_FAILED') return 'The Teams chat could not be resolved. The message was not sent.';
    if (code === 'SHUTTING_DOWN') return 'Teams sending is unavailable while FlightDeck is closing.';
    return 'Delivery could not be confirmed. Check Teams before trying again.';
  }

  function synthesisError(code) {
    if (code === 'AUTH_REQUIRED') return 'WorkIQ sign-in is required before generating a proposal.';
    if (code === 'TIMEOUT') return 'Proposal synthesis timed out. Retry when WorkIQ is available.';
    return 'Could not generate a grounded proposal. Try again.';
  }

  function snoozeSelected() {
    if (!selected) return;
    setItemField(selected.id, 'snoozeUntil', new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString());
  }

  function requestDeleteSelected(event) {
    if (!selected || deleteState.status === 'deleting') return;
    const menu = event.currentTarget.closest('details');
    const returnFocus = menu?.querySelector('summary') || event.currentTarget;
    if (menu) menu.open = false;
    deleteState = { status: 'idle', message: '' };
    deleteRequest = {
      id: selected.id,
      title: selected.title || 'Untitled item',
      replacementId: nextItemSelectionAfterRemoval(threads, selected.id),
      returnFocus,
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
      selectedId = replacementId;
      originatingThread = null;
      mobileStep = replacementId ? 'detail' : 'list';
      synthesisState = { threadId: null, requestedChannel: null, status: 'idle', result: null, error: '' };
      teamsDraft = null;
      teamsCopyStatus = '';
      teamsSendState = { status: 'idle', message: '' };
      deleteState = { status: 'idle', message: '' };
      if (replacementId) requestAnimationFrame(() => viewRoot?.querySelector('.radar-thread-detail h2')?.focus());
      return;
    }

    selectedId = threads.some((thread) => thread.id === request.id) ? request.id : null;
    mobileStep = selectedId ? 'detail' : 'list';
    deleteState = {
      status: 'error',
      message: itemDeletionFailureMessage(result.code),
    };
    if (selectedId) requestAnimationFrame(() => viewRoot?.querySelector('.radar-thread-detail h2')?.focus());
  }

  function preview(item) {
    const update = latestMailboxUpdate(item);
    return update?.summary || item.summary || item.reason || 'No activity yet';
  }

  function viewCount(view) {
    return projectionIndex.viewCounts.get(view.id) || 0;
  }

  function scannerThreadCount(requestedScannerId) {
    return projectionIndex.scannerCounts.get(requestedScannerId) || 0;
  }

  function dueInputValue(value) {
    const date = new Date(value || '');
    if (!Number.isFinite(date.getTime())) return '';
    const local = new Date(date.getTime() - date.getTimezoneOffset() * 60_000);
    return local.toISOString().slice(0, 16);
  }

  function updateDueDate(itemId, value) {
    setItemField(itemId, 'dueAt', value ? new Date(value).toISOString() : null);
  }

  function openNewScanner() {
    editingScanner = null;
    scannerModalOpen = true;
  }

  function openScannerSettings(event) {
    editingScanner = $scanners.find((scanner) => scanner.id === scannerId) || null;
    if (editingScanner) {
      scannerSettingsFocusOrigin = event?.currentTarget || document.activeElement;
      scannerModalOpen = true;
    }
  }

  function saveScanner(data) {
    const normalized = normalizeScannerDefinition({ ...editingScanner, ...data });
    normalized.nextRunAt = normalized.enabled ? computeScannerNextRunAt(normalized) : null;
    scanners.update((entries) => {
      const exists = entries.some((entry) => entry.id === normalized.id);
      return exists
        ? entries.map((entry) => entry.id === normalized.id ? normalized : entry)
        : [...entries, normalized];
    });
    scannerId = normalized.id;
    addHistory('action', `${editingScanner ? 'Updated' : 'Created'} scanner "${normalized.name}"`, { scannerId: normalized.id });
    savePersistentState();
    scannerModalOpen = false;
  }

  function toggleScanner() {
    const scanner = $scanners.find((entry) => entry.id === scannerId);
    if (!scanner) return;
    scanners.update((entries) => entries.map((entry) => entry.id === scanner.id
      ? { ...entry, enabled: !entry.enabled, nextRunAt: entry.enabled ? null : computeScannerNextRunAt({ ...entry, enabled: true }) }
      : entry));
    addHistory('action', `${scanner.enabled ? 'Paused' : 'Resumed'} scanner "${scanner.name}"`, { scannerId: scanner.id });
    savePersistentState();
  }

  function scannerRunFailureMessage(code) {
    if (code === 'BUSY') return 'This scanner is already running. Wait for it to finish.';
    if (code === 'INVALID_RESPONSE') return 'The scanner returned an invalid result. Try again.';
    return 'The scanner could not run. Try again.';
  }

  async function runScannerNow(scanner) {
    try {
      const result = await runScanner(scanner);
      if (result?.ok === false) {
        showToast(scannerRunFailureMessage(result.code), { icon: '!' });
      } else if (result?.ok === true && result.newItemCount === 0) {
        showToast(`Scanner "${scanner.name}" completed; no new items`, { icon: '\u2713' });
      }
      return result;
    } catch (_) {
      logError('scanner', 'Manual scanner run failed', { scannerId: scanner?.id });
      showToast('The scanner could not run. Try again.', { icon: '!' });
      return { ok: false, code: 'FAILED' };
    }
  }

  async function runEditingScanner() {
    if (!editingScanner || !$connected || $isDemo) return;
    const result = await runScannerNow(editingScanner);
    if (result?.ok !== true) return;
    savePersistentState();
    scannerModalOpen = false;
  }

  async function runSelectedScanner() {
    const scanner = $scanners.find((entry) => entry.id === scannerId);
    if (!scanner || !$connected || $isDemo) return;
    const result = await runScannerNow(scanner);
    if (result?.ok !== true) return;
    savePersistentState();
  }

  function requestScannerDeletion({ scannerId: requestedScannerId, returnFocus }) {
    const preview = previewScannerDeletion(requestedScannerId);
    if (preview?.ok === false) return;
    scannerModalOpen = false;
    scannerDeletion = {
      open: true,
      preview,
      status: 'idle',
      message: '',
      returnFocus: scannerSettingsFocusOrigin || returnFocus || null,
    };
  }

  function cancelScannerDeletion() {
    const canReopenSettings = editingScanner
      && $scanners.some((entry) => entry.id === editingScanner.id);
    scannerDeletion = {
      open: false,
      preview: null,
      status: 'idle',
      message: '',
      returnFocus: null,
    };
    if (canReopenSettings) {
      scannerModalOpen = true;
      requestAnimationFrame(() => {
        document.querySelector('[data-testid="scanner-settings-delete"]')?.focus();
      });
    }
  }

  function scannerDeletionFailureMessage(code) {
    if (code === 'BUSY') return 'This scanner or one of its threads is running. Wait for it to finish, then try again.';
    if (code === 'PERSISTENCE_FAILED') return 'FlightDeck could not save this change. Nothing was deleted. Check storage access and try again.';
    if (code === 'INVALID_TARGET') return 'That destination is no longer available. Review the updated destinations and choose another one.';
    if (code === 'NOT_FOUND') return 'This scanner no longer exists. Cancel and refresh Radar.';
    return 'The scanner could not be deleted. Review the impact and try again.';
  }

  function replacementAfterScannerDeletion(affectedItemIds) {
    const affected = new Set(affectedItemIds);
    const view = VIEWS.find((entry) => entry.id === smartView) || VIEWS[0];
    const needle = query.trim().toLowerCase();
    return projected.find((item) =>
      !affected.has(item.id)
      && view.predicate(item, now)
      && (!needle || [item.title, item.summary, item.reason, item.owner, ...(item.counterparties || [])]
        .some((value) => String(value || '').toLowerCase().includes(needle)))
    )?.id || null;
  }

  async function confirmScannerDeletion(request) {
    if (!scannerDeletion.preview || ['submitting', 'recovery'].includes(scannerDeletion.status)) return;
    const currentPreview = scannerDeletion.preview;
    const replacementId = request.disposition === 'delete-all'
      ? replacementAfterScannerDeletion(currentPreview.itemIds)
      : selectedId;
    scannerDeletion = { ...scannerDeletion, status: 'submitting', message: '' };

    const result = await executeScannerDeletion({
      scannerId: currentPreview.scanner.id,
      disposition: request.disposition,
      targetScannerId: request.targetScannerId,
      previewToken: request.previewToken,
    });

    if (result.ok) {
      const selectedWasDeleted = request.disposition === 'delete-all'
        && result.affectedItemIds.includes(selectedId);
      const highlightedWasDeleted = request.disposition === 'delete-all'
        && result.affectedItemIds.includes(get(highlightedItemId));
      scannerId = 'all';
      editingScanner = null;
      scannerSettingsFocusOrigin = null;
      scannerModalOpen = false;
      if (selectedWasDeleted) {
        selectedId = replacementId;
        originatingThread = null;
        mobileStep = replacementId ? 'detail' : 'list';
        synthesisState = { threadId: null, requestedChannel: null, status: 'idle', result: null, error: '' };
        teamsDraft = null;
        teamsCopyStatus = '';
        teamsSendState = { status: 'idle', message: '' };
      }
      if (highlightedWasDeleted) highlightedItemId.set(null);
      scannerDeletion = {
        open: false,
        preview: null,
        status: 'idle',
        message: '',
        returnFocus: null,
      };
      requestAnimationFrame(() => {
        const focusTarget = replacementId
          ? viewRoot?.querySelector('.radar-thread-detail h2')
          : viewRoot?.querySelector('[data-testid="radar-new-scanner"]');
        focusTarget?.focus();
      });
      return;
    }

    if (result.code === 'STALE_PREVIEW') {
      const refreshedPreview = previewScannerDeletion(currentPreview.scanner.id);
      scannerDeletion = refreshedPreview?.ok === false
        ? {
            ...scannerDeletion,
            status: 'error',
            message: scannerDeletionFailureMessage(refreshedPreview.code),
          }
        : {
            ...scannerDeletion,
            preview: refreshedPreview,
            status: 'error',
            message: 'The scanner changed while you were reviewing it. Review the updated impact and confirm again.',
          };
      return;
    }

    if (result.code === 'INVALID_TARGET') {
      const refreshedPreview = previewScannerDeletion(currentPreview.scanner.id);
      scannerDeletion = {
        ...scannerDeletion,
        preview: refreshedPreview?.ok === false ? currentPreview : refreshedPreview,
        status: 'error',
        message: scannerDeletionFailureMessage(result.code),
      };
      return;
    }

    if (result.code === 'PERSISTENCE_RECOVERY_REQUIRED') {
      scannerDeletion = {
        ...scannerDeletion,
        status: 'recovery',
        message: 'FlightDeck could not verify recovery after the save failed. Reload the app before making more changes.',
      };
      return;
    }

    scannerDeletion = {
      ...scannerDeletion,
      status: 'error',
      message: scannerDeletionFailureMessage(result.code),
    };
  }

  function createTask(data) {
    if (!String(data?.title || '').trim()) return;
    const item = normalizeItem({
      ...data,
      origin: 'custom',
      sourceType: 'Custom',
      status: 'Inbound',
      lifecycleStatus: 'in-progress',
      monitorPrompt: data.context,
      monitorEnabled: true,
      monitorSignals: data.signals,
    });
    items.update((entries) => [item, ...entries]);
    smartView = 'inbox';
    scannerId = 'all';
    selectedId = item.id;
    mobileStep = 'detail';
    taskModalOpen = false;
    addHistory('action', `Added item "${item.title}"`, { itemId: item.id, scannerId: item.scannerId });
    savePersistentState();
  }

  async function runSelectedItem() {
    if (!selected || !$connected || $isDemo) return;
    await runItemCheck(selected);
    savePersistentState();
  }

  function openSelectedPopout() {
    if (selected && window.workiq && typeof window.workiq.openTrackerPopout === 'function') {
      window.workiq.openTrackerPopout(selected.id);
    }
  }
</script>

<section class="command-view radar-workspace" aria-label="Radar workspace" bind:this={viewRoot}>
  <header class="command-view__heading radar-workspace__heading">
    <div>
      <span>WORK TRIAGE</span>
      <h1>Radar</h1>
      <p>Prioritized signals with deterministic thread actions.</p>
    </div>
    <div class="radar-search">
      <label class="sr-only" for="radar-search">Search Radar</label>
      <input id="radar-search" type="search" placeholder="Search threads" bind:value={query} />
      <label class="sr-only" for="radar-scanner">Scanner</label>
      <select id="radar-scanner" bind:value={scannerId}>
        <option value="all">All scanners</option>
        {#each $scanners as scanner (scanner.id)}
          <option value={scanner.id}>{scanner.name}</option>
        {/each}
      </select>
      <label class="sr-only" for="radar-sort">Sort</label>
      <select id="radar-sort" bind:value={sort}>
        <option value="priority">Priority</option>
        <option value="recent">Recent</option>
      </select>
      <button type="button" class="small-btn primary" data-testid="radar-new-scanner" on:click={openNewScanner}>New scanner</button>
      <button type="button" class="small-btn" disabled={!$scanners.length} data-testid="radar-add-item"
        on:click={() => { taskModalOpen = true; }}>Add item</button>
    </div>
  </header>

  <nav class="radar-mobile-progress" aria-label="Radar steps">
    <button type="button" class:active={mobileStep === 'filters'} on:click={() => { mobileStep = 'filters'; }}>Views</button>
    <button type="button" class:active={mobileStep === 'list'} on:click={() => { mobileStep = 'list'; }}>Threads</button>
    <button type="button" class:active={mobileStep === 'detail'} disabled={!selected}
      on:click={() => { if (selected) mobileStep = 'detail'; }}>Detail</button>
  </nav>

  <div class="radar-triage">
    <aside class="radar-smart-views" class:mobile-active={mobileStep === 'filters'} aria-label="Smart views">
      <section>
        <h2>Smart views</h2>
        {#each VIEWS as view (view.id)}
          <button type="button" class:active={smartView === view.id}
            aria-pressed={smartView === view.id}
            data-testid={`radar-view-${view.id}`}
            on:click={() => chooseView(view.id)}>
            <i class:enabled={viewCount(view) > 0}></i>
            <span>{view.label}</span>
            <strong>{viewCount(view)}</strong>
          </button>
        {/each}
      </section>
      <section>
        <h2>Scanners</h2>
        {#each $scanners as scanner (scanner.id)}
          <button type="button" class:active={scannerId === scanner.id}
            on:click={() => { scannerId = scanner.id; mobileStep = 'list'; }}>
            <i class:enabled={scanner.enabled}></i>
            <span>{scanner.name}</span>
            <strong>{scannerThreadCount(scanner.id)} · {scanner.enabled ? 'On' : 'Paused'}</strong>
          </button>
        {/each}
        {#if scannerId !== 'all'}
          {@const currentScanner = $scanners.find((scanner) => scanner.id === scannerId)}
          {#if currentScanner}
            <dl class="radar-scanner-status">
              <div><dt>Last run</dt><dd>{safeDate(currentScanner.lastRunAt, 'Never')}{currentScanner.lastRunStatus === 'success' ? ' · Completed' : currentScanner.lastRunStatus === 'failed' ? ' · Failed' : ''}</dd></div>
              <div><dt>Next run</dt><dd>{safeDate(currentScanner.nextRunAt, 'Not scheduled')}</dd></div>
            </dl>
          {/if}
          <div class="radar-scanner-actions">
            <button type="button" class="small-btn" data-testid="radar-edit-scanner" on:click={openScannerSettings}>Settings</button>
            <button type="button" class="small-btn" data-testid="radar-toggle-scanner" on:click={toggleScanner}>
              {$scanners.find((scanner) => scanner.id === scannerId)?.enabled ? 'Pause' : 'Resume'}
            </button>
            <button type="button" class="small-btn" disabled={!$connected || $isDemo}
              title={$isDemo ? 'Scanner execution is disabled in demo mode' : !$connected ? 'Connect WorkIQ to run this scanner' : 'Run scanner now'}
              on:click={runSelectedScanner}>Run scanner</button>
          </div>
        {/if}
      </section>
      <p class="radar-smart-views__hint">Actions remove a thread from the current projection without selecting a replacement.</p>
    </aside>

    <section class="radar-thread-list-pane" class:mobile-active={mobileStep === 'list'} aria-label="Radar threads">
      <header>
        <strong>{VIEWS.find((entry) => entry.id === smartView)?.label}</strong>
        <span>{threads.length} {threads.length === 1 ? 'thread' : 'threads'}</span>
      </header>
      <div class="inbox-filter-bar" aria-label="Inbox filters">
        <div class="inbox-quick-filters" role="group" aria-label="Quick filters">
          <button type="button" data-testid="inbox-quick-unread" aria-pressed={quickFilter === 'unread'} on:click={() => toggleQuickFilter('unread')}>Unread</button>
          <button type="button" data-testid="inbox-quick-new" aria-pressed={quickFilter === 'new'} on:click={() => toggleQuickFilter('new')}>NEW</button>
          <button type="button" data-testid="inbox-quick-updated" aria-pressed={quickFilter === 'updated'} on:click={() => toggleQuickFilter('updated')}>UPDATED</button>
          <button type="button" data-testid="inbox-quick-critical" aria-pressed={quickFilter === 'critical'} on:click={() => toggleQuickFilter('critical')}>Critical</button>
          <button type="button" data-testid="inbox-quick-blocked" aria-pressed={quickFilter === 'blocked'} on:click={() => toggleQuickFilter('blocked')}>Blocked</button>
          <button type="button" data-testid="inbox-quick-due-soon" aria-pressed={quickFilter === 'due-soon'} on:click={() => toggleQuickFilter('due-soon')}>Due soon</button>
        </div>
        <details class="inbox-refine">
          <summary>Refine</summary>
          <div class="inbox-refine__panel">
            <fieldset>
              <legend>Severity</legend>
              {#each ['Critical', 'Elevated', 'Observe'] as value}
                <label><input type="checkbox" checked={refineFilters.severity?.includes(value)} on:change={(event) => toggleRefineFilter('severity', value, event.target.checked)} /> {value}</label>
              {/each}
            </fieldset>
            <fieldset>
              <legend>Lifecycle</legend>
              {#each LIFECYCLE_STATUSES as value}
                <label><input type="checkbox" checked={refineFilters.lifecycle?.includes(value)} on:change={(event) => toggleRefineFilter('lifecycle', value, event.target.checked)} /> {LIFECYCLE_LABELS[value]}</label>
              {/each}
            </fieldset>
            <fieldset>
              <legend>Scanner</legend>
              <label><input type="checkbox" checked={refineFilters.scanner?.includes('unassigned')} on:change={(event) => toggleRefineFilter('scanner', 'unassigned', event.target.checked)} /> Unassigned</label>
              {#each $scanners as scanner (scanner.id)}
                <label><input type="checkbox" checked={refineFilters.scanner?.includes(scanner.id)} on:change={(event) => toggleRefineFilter('scanner', scanner.id, event.target.checked)} /> {scanner.name}</label>
              {/each}
            </fieldset>
            <fieldset>
              <legend>Read state</legend>
              {#each ['unread', 'read'] as value}
                <label><input type="checkbox" checked={refineFilters.read?.includes(value)} on:change={(event) => toggleRefineFilter('read', value, event.target.checked)} /> {filterLabel(value)}</label>
              {/each}
            </fieldset>
            <fieldset>
              <legend>Monitoring</legend>
              {#each ['enabled', 'paused', 'disabled'] as value}
                <label><input type="checkbox" checked={refineFilters.monitoring?.includes(value)} on:change={(event) => toggleRefineFilter('monitoring', value, event.target.checked)} /> {filterLabel(value)}</label>
              {/each}
            </fieldset>
            <fieldset>
              <legend>Due</legend>
              {#each ['overdue', 'due-soon', 'later', 'none'] as value}
                <label><input type="checkbox" checked={refineFilters.due?.includes(value)} on:change={(event) => toggleRefineFilter('due', value, event.target.checked)} /> {filterLabel(value)}</label>
              {/each}
            </fieldset>
            <fieldset>
              <legend>Signal</legend>
              {#each ['email', 'chat', 'meeting', 'doc'] as value}
                <label><input type="checkbox" checked={refineFilters.signal?.includes(value)} on:change={(event) => toggleRefineFilter('signal', value, event.target.checked)} /> {filterLabel(value)}</label>
              {/each}
            </fieldset>
            <fieldset>
              <legend>Activity age</legend>
              {#each ['today', 'last-7-days', 'last-30-days', 'older', 'no-activity'] as value}
                <label><input type="checkbox" checked={refineFilters['activity-age']?.includes(value)} on:change={(event) => toggleRefineFilter('activity-age', value, event.target.checked)} /> {filterLabel(value)}</label>
              {/each}
            </fieldset>
          </div>
        </details>
        {#if activeFilters.length}
          <div class="inbox-active-filters" aria-label="Active filters">
            {#each activeFilters as filter (`${filter.facet}:${filter.value}`)}
              <button type="button" data-testid="inbox-active-filter"
                aria-label={`Remove ${filter.label} filter`}
                on:click={() => removeActiveFilter(filter)}>{filter.label} <span aria-hidden="true">×</span></button>
            {/each}
          </div>
        {/if}
      </div>
      <div class="radar-thread-list">
        {#if threads.length}
          {#each threads as item (item.id)}
            {@const statusLabel = mailboxWorkStatus(item)}
            {@const statusClass = mailboxWorkStatusClass(item)}
            {@const severityLabel = item.severity || 'Observe'}
            <button type="button" class="radar-thread mailbox-thread-row"
              class:selected={selectedId === item.id}
              class:unread={isMailboxUnread(item)}
              data-thread-id={item.id}
              aria-current={selectedId === item.id ? 'true' : undefined}
              tabindex={selectedId === item.id || (!selectedId && item.id === firstThreadId) ? 0 : -1}
              use:onkeydown={item}
              on:click={(event) => selectThread(item, event.currentTarget, { markRead: true })}>
              <span class="mailbox-row-topline radar-thread__top">
                <span class="mailbox-unread-dot" aria-label={isMailboxUnread(item) ? 'Unread' : 'Read'}></span>
                <strong>{item.title || 'Untitled item'}</strong>
                <time>{safeDate(mailboxActivityAt(item), 'No activity')}</time>
              </span>
              <span class="mailbox-row-preview radar-thread__preview">{preview(item)}</span>
              <span class="mailbox-row-meta radar-thread__meta">
                <span>{item.sourceType || 'Signal'}</span>
                {#if item.isNew}<span class="inbox-state-cue inbox-state-cue--new">NEW</span>{/if}
                {#if item.hasNewUpdate}<span class="inbox-state-cue inbox-state-cue--updated">UPDATED</span>{/if}
                {#if isMailboxSnoozed(item, now)}<span title={`Snoozed until ${safeDate(item.snoozeUntil)}`}>Snoozed</span>{/if}
                {#if item.monitorPaused}<span>Monitoring paused</span>{/if}
                <span class="mailbox-status mailbox-status-{statusClass}" title={`Work status: ${statusLabel}`}>{statusLabel}</span>
                <span class="mailbox-severity mailbox-severity-{severityLabel.toLowerCase()}" title={`Criticality: ${severityLabel}`}>{severityLabel}</span>
              </span>
            </button>
          {/each}
        {:else}
          <div class="command-empty">No threads match this view.</div>
        {/if}
      </div>
    </section>

    <article class="radar-thread-detail" class:mobile-active={mobileStep === 'detail'} aria-live="polite">
      {#if selected}
        <button type="button" class="radar-detail-back" data-testid="radar-detail-back" on:click={returnToThreads}>Back to threads</button>
        <header>
          <div>
            <span class="eyebrow">{selected.sourceType || 'Signal'}</span>
            <h2 tabindex="-1">{selected.title || 'Untitled item'}</h2>
            <p>{selected.owner || 'You'} · {safeDate(mailboxActivityAt(selected), 'No activity')}</p>
          </div>
          <span class="radar-status mailbox-status mailbox-status-{mailboxWorkStatusClass(selected)}">{mailboxWorkStatus(selected)}</span>
        </header>

        <section class="radar-control-strip" aria-label="Work item controls">
          <label class="radar-control-field">
            <span>Criticality</span>
            <span class="mailbox-severity mailbox-severity-{(selected.severity || 'Observe').toLowerCase()} radar-control-pill">
              <select aria-label="Criticality" value={selected.severity}
                on:change={(event) => setItemSeverity(selected.id, event.target.value)}>
                <option value="Critical">Critical</option>
                <option value="Elevated">Elevated</option>
                <option value="Observe">Observe</option>
              </select>
            </span>
          </label>
          <label class="radar-control-field">
            <span>Work state</span>
            <span class="mailbox-status mailbox-status-{mailboxWorkStatusClass(selected)} radar-control-pill">
              <select aria-label="Work state" value={selected.lifecycleStatus}
                on:change={(event) => setItemLifecycle(selected.id, event.target.value)}>
                {#each LIFECYCLE_STATUSES as status}
                  <option value={status}>{LIFECYCLE_LABELS[status]}</option>
                {/each}
              </select>
            </span>
          </label>
          <label class="radar-control-field">
            <span>Scanner assignment</span>
            <select aria-label="Scanner assignment"
              bind:value={() => selected.scannerId || '', (value) => setItemField(selected.id, 'scannerId', value || null)}>
              <option value="">Unassigned</option>
              {#each $scanners as scanner (scanner.id)}
                <option value={scanner.id}>{scanner.name}</option>
              {/each}
            </select>
          </label>
          <label class="radar-control-field">
            <span>Due date</span>
            <input aria-label="Due date" type="datetime-local"
              bind:value={() => dueInputValue(selected.dueAt), (value) => updateDueDate(selected.id, value)} />
          </label>
          <label class="radar-control-field radar-control-field--grow">
            <span>Owner</span>
            <input aria-label="Owner" type="text" maxlength="160"
              bind:value={() => selected.owner || '', (value) => setItemField(selected.id, 'owner', value.trim())} />
          </label>
          <label class="radar-control-field radar-control-field--wide">
            <span>Done criteria</span>
            <input aria-label="Done criteria" type="text" maxlength="500"
              bind:value={() => selected.doneCriteria || '', (value) => setItemField(selected.id, 'doneCriteria', value.trim())} />
          </label>
          {#if isMailboxUnread(selected)}
            <button type="button" class="small-btn radar-utility-button" title="Mark this item as read" on:click={() => markItemRead(selected.id)}>Read</button>
          {/if}
          <button type="button" class="small-btn radar-utility-button" title="Open this item in a separate window" on:click={openSelectedPopout}>Open</button>
        </section>

        <div class="radar-detail-columns">
        <section class="radar-detail-section radar-command-bar radar-work-panel">
          <h3>Work plan</h3>
          <div class="radar-context-block radar-context-recommendations" data-testid="scanner-recommendations">
            <h4>Recommended next moves</h4>
            {#if Array.isArray(selected.suggestedNextSteps) && selected.suggestedNextSteps.length}
              <ol>
                {#each selected.suggestedNextSteps.slice(0, 2) as step}
                  <li>{step}</li>
                {/each}
              </ol>
            {:else}
              <p>Review this thread and choose the next action.</p>
            {/if}
          </div>
          {#if synthesisState.threadId === selected.id && synthesisState.status === 'error'}
            <p class="radar-change" role="alert" data-testid="proposal-error">{synthesisState.error}</p>
          {/if}
          {#if synthesisState.threadId === selected.id && synthesisState.status === 'ready'
            && !synthesisState.result.proposals.length}
            <p class="radar-change" data-testid="proposal-no-communication">
              {synthesisState.result.noCommunicationReason || synthesisState.result.recommendation}
            </p>
          {/if}
          {#if teamsDraft}
            <section class="radar-teams-draft" data-testid="teams-draft-editor">
              <header>
                <div>
                  <span class="eyebrow">TEAMS MESSAGE</span>
                  <h3>Review and send</h3>
                </div>
                <span class="radar-draft-status">Draft</span>
              </header>
              <div class="radar-teams-draft__fields">
                <label>
                  <span>Recipient</span>
                  <input type="text" maxlength="160" autocomplete="off" placeholder="Exact Teams display name"
                    bind:value={teamsDraft.target} />
                  {#if !teamsDraft.target.trim()}
                    <small class="radar-change">Enter one exact Teams display name.</small>
                  {/if}
                </label>
                <label>
                  <span>Message</span>
                  <textarea rows="7" maxlength="4000" bind:value={teamsDraft.message}></textarea>
                </label>
              </div>
              <dl class="radar-context-meta">
                {#if teamsDraft.why}<div><dt>Why</dt><dd>{teamsDraft.why}</dd></div>{/if}
                {#if teamsDraft.risk}<div><dt>Risk</dt><dd>{teamsDraft.risk}</dd></div>{/if}
                {#if teamsDraft.reviewNote}<div><dt>Review note</dt><dd>{teamsDraft.reviewNote}</dd></div>{/if}
              </dl>
              <p class="radar-teams-draft__note">Review the recipient and message before sending. FlightDeck will ask for confirmation.</p>
              <div class="command-buttons radar-teams-draft__actions">
                <button type="button" class="small-btn primary" data-testid="teams-draft-send"
                  disabled={!teamsDraft.target.trim() || teamsSendState.status === 'sending' || teamsSendState.status === 'sent'}
                  on:click={sendTeamsDraft}>
                  {teamsSendState.status === 'sending' ? 'Sending…' : teamsSendState.status === 'sent' ? 'Sent' : 'Send message'}
                </button>
                <button type="button" class="small-btn" data-testid="teams-draft-copy" on:click={copyTeamsDraft}>Copy message</button>
                <button type="button" class="small-btn" on:click={() => { teamsDraft = null; teamsCopyStatus = ''; teamsSendState = { status: 'idle', message: '' }; }}>Close</button>
                {#if teamsCopyStatus}<span role="status">{teamsCopyStatus}</span>{/if}
              </div>
              {#if teamsSendState.message}
                <p class="radar-change" role="status" data-testid="teams-send-status">{teamsSendState.message}</p>
              {/if}
            </section>
          {/if}
          {#if deleteState.status === 'error'}
            <p class="radar-change" role="alert" data-testid="radar-delete-error">{deleteState.message}</p>
          {/if}
          <div class="radar-action-toolbar">
            <div class="radar-action-cluster">
              <span class="radar-action-label">Respond</span>
              <div class="radar-action-group radar-action-group--compose" role="group" aria-label="Compose a response"
                aria-busy={synthesisState.threadId === selected.id && synthesisState.status === 'generating' ? 'true' : 'false'}>
                <button type="button" class="small-btn radar-action-button radar-action-button--compose" data-testid="radar-draft-email"
                  title="Create an editable Outlook draft"
                  class:is-loading={synthesisState.threadId === selected.id && synthesisState.requestedChannel === 'email' && synthesisState.status === 'generating'}
                  disabled={synthesisState.threadId === selected.id && synthesisState.status === 'generating'}
                  on:click={(event) => draftMessage('email', event.currentTarget)}>
                  {synthesisState.threadId === selected.id && synthesisState.requestedChannel === 'email' && synthesisState.status === 'generating'
                    ? 'Drafting…'
                    : 'Email'}
                </button>
                <button type="button" class="small-btn radar-action-button radar-action-button--compose" data-testid="radar-draft-teams"
                  title="Draft a Teams message for review"
                  class:is-loading={synthesisState.threadId === selected.id && synthesisState.requestedChannel === 'teams' && synthesisState.status === 'generating'}
                  disabled={synthesisState.threadId === selected.id && synthesisState.status === 'generating'}
                  on:click={(event) => draftMessage('teams', event.currentTarget)}>
                  {synthesisState.threadId === selected.id && synthesisState.requestedChannel === 'teams' && synthesisState.status === 'generating'
                    ? 'Drafting…'
                    : 'Teams'}
                </button>
              </div>
            </div>
            <div class="radar-action-cluster radar-action-cluster--manage">
              <span class="radar-action-label">Manage</span>
              <div class="radar-action-group radar-action-group--disposition" role="group" aria-label="Update thread status">
                <button type="button" class="small-btn radar-action-button radar-action-button--complete" data-testid="radar-complete"
                  title="Mark this item complete" on:click={() => setItemLifecycle(selected.id, 'complete')}>Complete</button>
                <button type="button" class="small-btn radar-action-button radar-action-button--snooze" data-testid="radar-snooze"
                  title="Snooze this item for one day" on:click={snoozeSelected}>Snooze</button>
                <details class="radar-more-menu">
                  <summary class="small-btn radar-action-button" data-testid="radar-more">More</summary>
                  <div class="radar-more-menu__panel" role="menu" aria-label="More item actions">
                    <button type="button" class="radar-more-menu__item" data-testid="radar-archive"
                      title="Archive this item" on:click={() => setItemLifecycle(selected.id, 'archived')}>Archive</button>
                    <button type="button" class="radar-more-menu__item radar-more-menu__item--delete" data-testid="radar-delete"
                      title="Delete this local FlightDeck card" disabled={deleteState.status === 'deleting'}
                      on:click={requestDeleteSelected}>Delete from FlightDeck…</button>
                  </div>
                </details>
              </div>
            </div>
          </div>
        </section>

          <section class="radar-detail-section radar-activity-panel">
            <h3>Activity</h3>
            {#if timeline.length}
              <ActivityTimeline entries={timeline} item={selected} maxVisible={5} />
            {:else}
              <p>No activity recorded.</p>
            {/if}
          </section>
          <section class="radar-detail-section radar-work-details">
            {#if selected.reason && selected.reason !== selected.summary}
              <div class="radar-context-block" data-testid="radar-context-reason">
                <h4>Why it matters</h4>
                <p>{selected.reason}</p>
              </div>
            {/if}
            <div class="radar-context-block radar-context-done" data-testid="radar-context-done">
              <h4>Done when</h4>
              <p>{selected.doneCriteria || 'Completion criteria have not been defined yet.'}</p>
            </div>
            <dl class="radar-context-meta">
              <div><dt>Source</dt><dd>{selected.sourceType || 'Signal'}</dd></div>
              <div><dt>Owner</dt><dd>{selected.owner || 'You'}</dd></div>
              <div><dt>Due</dt><dd>{safeDate(selected.dueAt, 'No due date')}</dd></div>
              <div><dt>Last checked</dt><dd>{safeDate(selected.lastRunAt, 'Never')}</dd></div>
              {#if selected.completionConfidence}
                <div><dt>Completion confidence</dt><dd>{selected.completionConfidence}</dd></div>
              {/if}
            </dl>
            <div class="radar-context-block" data-testid="radar-context-people">
              <h4>People <span>{selected.counterparties?.length || 0}</span></h4>
              {#if Array.isArray(selected.counterparties) && selected.counterparties.length}
                <div class="radar-people-list">
                  {#each selected.counterparties as person}
                    <span>{person}</span>
                  {/each}
                </div>
              {:else}
                <p>No counterparties listed.</p>
              {/if}
            </div>
            <div class="radar-context-block" data-testid="radar-context-sources">
              <h4>Sources <span>{sourceLinks.length}</span></h4>
              {#if sourceLinks.length}
                <ul class="radar-source-list">
                  {#each sourceLinks as evidence}
                    <li>
                      <span class="radar-source-type radar-source-type--{evidence.type || 'source'}">{evidenceTypeLabel(evidence.type)}</span>
                      <a href={evidence.url} target="_blank" rel="noopener noreferrer"
                        on:click={(event) => openEvidenceLink(event, evidence.url)}>{evidence.label || 'Open source'}</a>
                      {#if evidence.signalAt}<time>{safeDate(evidence.signalAt)}</time>{/if}
                    </li>
                  {/each}
                </ul>
              {:else}
                <p>No direct source links available.</p>
              {/if}
            </div>
            {#if duplicates.length}<p class="radar-related-count">{duplicates.length} related thread(s) detected.</p>{/if}
          </section>
        </div>

        {#if selected.lifecycleStatus !== 'complete' && selected.lifecycleStatus !== 'archived'}
          <details class="radar-detail-section">
            <summary>Monitoring schedule</summary>
            <ScheduleControls item={selected}
              onchange={(data) => setItemField(data.itemId, data.field, data.value)}
              onrunnow={runSelectedItem} />
          </details>
        {/if}
      {:else}
        <div class="command-empty">Select a thread to inspect its details.</div>
      {/if}
    </article>
  </div>
</section>

<ScannerSettingsModal open={scannerModalOpen} scanner={editingScanner}
  canRun={$connected && !$isDemo}
  runDisabledReason={$isDemo ? 'Scanner execution is disabled in demo mode' : 'Connect WorkIQ to run this scanner'}
  onsave={saveScanner} onrunnow={runEditingScanner} ondelete={requestScannerDeletion}
  onclose={() => { scannerModalOpen = false; }} />

<ScannerDeletionModal open={scannerDeletion.open} preview={scannerDeletion.preview}
  status={scannerDeletion.status} message={scannerDeletion.message}
  returnFocus={scannerDeletion.returnFocus}
  onconfirm={confirmScannerDeletion} oncancel={cancelScannerDeletion} />

<AddTaskModal open={taskModalOpen}
  scannerId={scannerId === 'all' ? $scanners[0]?.id : scannerId}
  oncreate={createTask} oncancel={() => { taskModalOpen = false; }} />

<ConfirmModal open={Boolean(deleteRequest)}
  title={ITEM_DELETION_CONFIRMATION.title}
  summary={ITEM_DELETION_CONFIRMATION.summary}
  targets={deleteRequest?.title || ''}
  confirmLabel={ITEM_DELETION_CONFIRMATION.confirmLabel}
  returnFocus={deleteRequest?.returnFocus || null}
  onconfirm={confirmDeleteSelected}
  oncancel={() => { deleteRequest = null; }} />
