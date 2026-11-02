<script>
  import { onDestroy } from 'svelte';
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
  } from '../lib/proposal-synthesis.js';
  import { createActionProposal, isConfirmedCommunication, isWorkPlanStepCompleted, normalizeWorkPlanStep } from '../lib/action-proposals.js';
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
  import { canAddressTeamsDraft, emptyThreadComposer, threadComposer } from '../lib/thread-composer.js';
  import { hydrateRadarColdItems, resolveRadarItem } from '../lib/radar-navigation.js';
  import { ITEM_DELETION_CONFIRMATION, itemDeletionFailureMessage } from '../lib/item-deletion-ui.js';
  import ActivityTimeline from './ActivityTimeline.svelte';
  import EmailDraft from './EmailDraft.svelte';
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
  let actionPreviewOrigin = null;
  let mounted = true;
  onDestroy(() => { mounted = false; });
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
  let synthesisState = $derived($threadComposer.get(selectedId) || emptyThreadComposer());
  let teamsDraft = $derived(synthesisState.teamsDraft);
  let teamsCopyStatus = $derived(synthesisState.teamsCopyStatus);
  let teamsSendState = $derived(synthesisState.teamsSendState);
  let creatingEmailItemIds = $derived(new Set($actionProposals
    .filter((proposal) => proposal.channel === 'outlook-draft' && proposal.state === 'Executing')
    .map((proposal) => proposal.sourceItemId)));
  let emailProposal = $derived(
    $actionProposals.find((proposal) => proposal.id === synthesisState.emailProposalId)
      || $actionProposals.filter((proposal) => proposal.sourceItemId === selectedId
        && proposal.channel === 'outlook-draft' && !proposal.archivedAt && !proposal.auditOnly)
        .sort((left, right) => Date.parse(right.updatedAt) - Date.parse(left.updatedAt))[0]
      || null
  );
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
  let nextMoves = $derived(selected?.suggestedNextSteps?.slice(0, 2) || []);
  let availableNextMoves = $derived(nextMoves.filter((step) => !isWorkPlanStepCompleted(selected, step)));
  let selectedNextMove = $derived(availableNextMoves.includes(synthesisState.selectedNextStep)
    ? synthesisState.selectedNextStep : availableNextMoves[0] || '');
  let workPlanCompleted = $derived(nextMoves.length > 0 && !availableNextMoves.length);
  let timeline = $derived([...(selected?.updateHistory || [])].sort((a, b) => Date.parse(b.timestamp || 0) - Date.parse(a.timestamp || 0)));
  let viewedAction = $derived(timeline.find((entry) => entry.eventId === synthesisState.viewedActionId && canViewCommunication(entry)) || null);
  let viewedMessage = $derived(viewedAction ? $actionProposals.find((proposal) => proposal.id === viewedAction.proposalId
    && proposal.sourceItemId === selected?.id && proposal.channel === viewedAction.channel && isConfirmedCommunication(proposal)) || null : null);
  let sourceLinks = $derived(selected ? collectItemEvidenceLinks(selected) : []);
  let duplicates = $derived(selected
    ? (projectionIndex.titleGroups.get(selected.title?.split(/\s+[—-]\s+/)[0]) || [])
      .filter((item) => item.id !== selected.id)
    : []);

  function resetTeamsDraft() {
    threadComposer.update(selectedId, {
      teamsDraft: null, teamsCopyStatus: '', teamsSendState: { status: 'idle', message: '' },
    });
  }

  function setSelectedThreadId(nextId) {
    selectedId = nextId;
  }

  function editTeamsDraft(field, value) {
    threadComposer.update(selectedId, {
      teamsDraft: { ...teamsDraft, [field]: value, ...(field === 'target' ? { targetEmail: '' } : {}) },
    });
  }

  $effect(() => {
    const preserveId = pendingNavigationId && projected.some((item) => item.id === pendingNavigationId)
      ? pendingNavigationId
      : null;
    const next = reconcileRadarSelection({ selectedId, mobileStep, smartView, scannerId, query }, threads, { preserveId });
    if (next.selectedId !== selectedId || next.mobileStep !== mobileStep) {
      setSelectedThreadId(next.selectedId);
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
      setSelectedThreadId(highlighted.id);
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
    setSelectedThreadId(item.id);
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
    setSelectedThreadId(target.id);
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
    setSelectedThreadId(null);
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

  async function recordRadarActionEvent({ proposalId, itemId, event, timestamp, channel, target, outcome, verification, code, nextStep, attempt = 0 }) {
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
      nextStep,
    });
  }

  async function draftMessage(requestedChannel, initiator = null, requestedNextStep = selectedNextMove) {
    if (!selected || creatingEmailItemIds.has(selected.id) || workPlanCompleted || isWorkPlanStepCompleted(selected, requestedNextStep)) return;
    const sourceItem = selected;
    const state = await threadComposer.generate({
      item: sourceItem,
      channel: requestedChannel,
      requestedNextStep,
      propose: window.workiq?.proposeThreadActions,
      isAvailable: (id) => !get(deletedItemIds).includes(id),
      saveEmail: async (item, channelResult, current, nextStep) => {
        const existing = get(actionProposals);
        const created = adaptEmailProposalsToActionQueue(item, channelResult, existing, { sourceNextStep: nextStep });
        const matchingExisting = existing.find((entry) =>
          entry.sourceItemId === item.id
          && entry.channel === 'outlook-draft'
          && normalizeWorkPlanStep(entry.sourceNextStep) === normalizeWorkPlanStep(nextStep)
          && channelResult.proposals.some((proposal) =>
            entry.target === (proposal.target.address || proposal.target.displayName)
            && entry.sourceTitle === proposal.payload.subject
            && entry.content === proposal.payload.body
          )
        );
        if (created.length) {
          if (!current()) return null;
          actionProposals.set([...created, ...existing]);
          for (const createdProposal of created) {
            await recordRadarActionEvent({
              proposalId: createdProposal.id,
              itemId: item.id,
              event: 'proposal-created',
              timestamp: createdProposal.createdAt,
              channel: createdProposal.channel,
              target: createdProposal.target,
              outcome: 'pending',
              verification: 'not-applicable',
              nextStep: createdProposal.sourceNextStep,
            });
            if (!current()) return null;
          }
        }
        return created[0]?.id || matchingExisting?.id || null;
      },
    });
    if (mounted && requestedChannel === 'email' && state?.emailProposalId
      && selected?.id === sourceItem.id) {
      reviewEmailProposal(state.emailProposalId, initiator);
    }
  }

  function reviewEmailProposal(proposalId, initiator) {
    if (!get(actionProposals).some((proposal) => proposal.id === proposalId)) return;
    threadComposer.update(selectedId, { emailProposalId: proposalId, emailOpen: true });
    requestAnimationFrame(() => viewRoot?.querySelector('[data-testid="email-draft-recipient"]')?.focus());
  }

  function openEmailActions(proposalId, initiator) {
    selectedProposalId.set(proposalId);
    openActionsQueue(initiator);
  }

  function canViewCommunication(entry) {
    return entry.kind === 'action' && entry.event === 'succeeded' && entry.outcome === 'succeeded'
      && entry.verification === 'runtime-backend-confirmed'
      && ((entry.channel === 'teams' && entry.code === 'SEND_CONFIRMED')
        || (entry.channel === 'outlook-draft' && entry.code === 'DRAFT_SAVED'));
  }

  function viewCompletedAction(entry, initiator) {
    if (!canViewCommunication(entry)) return;
    actionPreviewOrigin = initiator;
    threadComposer.update(selectedId, { viewedActionId: entry.eventId });
    requestAnimationFrame(() => {
      const panel = viewRoot?.querySelector('[data-testid="action-message-preview"]');
      panel?.scrollIntoView({ block: 'start', behavior: 'smooth' });
      panel?.querySelector('h3')?.focus({ preventScroll: true });
    });
  }

  function closeActionPreview() {
    threadComposer.update(selectedId, { viewedActionId: null });
    if (actionPreviewOrigin?.isConnected) actionPreviewOrigin.focus({ preventScroll: true });
    actionPreviewOrigin = null;
  }

  async function copyTeamsDraft() {
    const draft = teamsDraft;
    if (!draft || draft.sourceItemId !== selected?.id || !draft.message) return;
    try {
      await navigator.clipboard.writeText(draft.message);
      if (threadComposer.read(draft.sourceItemId).teamsDraft === draft) {
        threadComposer.update(draft.sourceItemId, { teamsCopyStatus: 'Copied' });
      }
    } catch (_) {
      if (threadComposer.read(draft.sourceItemId).teamsDraft === draft) {
        threadComposer.update(draft.sourceItemId, { teamsCopyStatus: 'Copy unavailable' });
      }
    }
  }

  async function sendTeamsDraft() {
    const draft = teamsDraft;
    if (!draft || draft.sourceItemId !== selected?.id || creatingEmailItemIds.has(selected.id)
      || isWorkPlanStepCompleted(selected, draft.nextStep) || ['sending', 'sent', 'unconfirmed'].includes(teamsSendState.status)) return;
    const target = draft.target.trim();
    const targetEmail = String(draft.targetEmail || '').trim();
    const auditTarget = targetEmail || target;
    const message = draft.message.trim();
    const setSendState = (state) => {
      if (threadComposer.read(draft.sourceItemId).teamsDraft?.proposalId === draft.proposalId) {
        threadComposer.update(draft.sourceItemId, { teamsSendState: state });
      }
    };
    if (!canAddressTeamsDraft(draft)) {
      setSendState({ status: 'error', message: 'Enter a valid recipient email address or an exact Teams name before sending.' });
      return;
    }
    if (!message) {
      setSendState({ status: 'error', message: 'Enter a message before sending.' });
      return;
    }
    if (typeof window.workiq?.sendTeamsMessage !== 'function') {
      setSendState({ status: 'error', message: 'Teams sending is unavailable. Try again after reconnecting WorkIQ.' });
      return;
    }

    const attempt = (draft.attempt || 0) + 1;
    const attemptedAt = new Date().toISOString();
    threadComposer.update(draft.sourceItemId, { teamsDraft: { ...draft, target, targetEmail, attempt } });
    setSendState({ status: 'sending', message: '' });
    let receiptConfirmed = false;
    try {
      const response = await window.workiq.sendTeamsMessage({
        targetDisplayName: target,
        ...(targetEmail ? { targetEmail } : {}),
        message,
      });
      if (response?.ok === true && response.action === 'teams-message-sent') {
        receiptConfirmed = true;
        const confirmedAt = new Date().toISOString();
        const sentMessage = {
          ...createActionProposal({ id: draft.sourceItemId, title: draft.sourceTitle, sourceType: draft.sourceType }, message, {
            id: draft.proposalId, createdAt: draft.createdAt, channel: 'teams', target: auditTarget,
            content: message, sourceNextStep: draft.nextStep, reason: draft.why, risk: draft.risk,
            provenance: 'Reviewed Teams message; matching send receipt',
          }),
          state: 'Succeeded', executionVerification: 'runtime-backend-confirmed',
          executionCode: 'SEND_CONFIRMED', dispatchStatus: 'dispatched',
          outcome: 'Teams message sent with a matching receipt.', updatedAt: confirmedAt,
          ...(get(deletedItemIds).includes(draft.sourceItemId) ? { auditOnly: true } : {}),
        };
        actionProposals.update((entries) => entries.some((entry) => entry.id === sentMessage.id)
          ? entries : [sentMessage, ...entries]);
        setSendState({ status: 'sent', message: 'Message sent. Teams returned a matching send receipt.' });
        await recordRadarActionEvent({
          proposalId: draft.proposalId,
          itemId: draft.sourceItemId,
          event: 'succeeded',
          timestamp: confirmedAt,
          channel: 'teams',
          target: auditTarget,
          outcome: 'succeeded',
          verification: 'runtime-backend-confirmed',
          code: 'SEND_CONFIRMED',
          nextStep: draft.nextStep,
          attempt,
        });
        if (get(deletedItemIds).includes(draft.sourceItemId)) await savePersistentState();
        return;
      }
      const code = safeTeamsCode(response?.code);
      if (code === 'CANCELLED') {
        await recordRadarActionEvent({
          proposalId: draft.proposalId,
          itemId: draft.sourceItemId,
          event: 'cancelled',
          timestamp: attemptedAt,
          channel: 'teams',
          target: auditTarget,
          outcome: 'cancelled',
          verification: 'not-applicable',
          code,
          attempt,
        });
        setSendState({ status: 'idle', message: 'Send cancelled. No request was dispatched. Your draft was not changed.' });
      } else {
        await recordRadarActionEvent({
          proposalId: draft.proposalId,
          itemId: draft.sourceItemId,
          event: 'failed',
          timestamp: attemptedAt,
          channel: 'teams',
          target: auditTarget,
          outcome: code === 'SEND_UNCONFIRMED' ? 'unverified' : 'failed',
          verification: code === 'SEND_UNCONFIRMED' ? 'unverified' : 'not-applicable',
          code,
          attempt,
        });
        setSendState({ status: code === 'SEND_UNCONFIRMED' ? 'unconfirmed' : 'error', message: teamsSendError(code) });
      }
    } catch (_) {
      if (receiptConfirmed) {
        logError('radar', 'Teams message sent, but local history could not be saved', { code: 'LOCAL_HISTORY_FAILED' });
        showToast('Message sent, but local history could not be saved. Do not send again.', { icon: '!', durationMs: 7000 });
        return;
      }
      await recordRadarActionEvent({
        proposalId: draft.proposalId,
        itemId: draft.sourceItemId,
        event: 'failed',
        timestamp: attemptedAt,
        channel: 'teams',
        target: auditTarget,
        outcome: 'unverified',
        verification: 'unverified',
        code: 'SEND_UNCONFIRMED',
        attempt,
      });
      setSendState({ status: 'unconfirmed', message: 'Delivery could not be confirmed. Check Teams before trying again.' });
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
    if (code === 'THROTTLED') return 'WorkIQ is rate limited. Wait for the cooldown before retrying.';
    if (code === 'TARGET_NOT_FOUND') return 'The recipient could not be verified from this address or an existing one-to-one chat. Check the recipient email. The message was not sent.';
    if (code === 'TARGET_AMBIGUOUS') return 'More than one recipient or matching chat was found. Verify the recipient email. The message was not sent.';
    if (code === 'SEND_UNCONFIRMED') return 'Delivery could not be confirmed. Check Teams before trying again.';
    if (code === 'INVALID_MESSAGE') return 'Review the recipient and message before retrying.';
    if (code === 'SEND_FAILED') return 'Teams reported that the message was not sent. Review the draft before trying again.';
    if (code === 'UNSUPPORTED') return 'Teams sending is unavailable through the connected WorkIQ service.';
    if (code === 'RESOLUTION_FAILED') return 'The Teams chat could not be resolved. The message was not sent.';
    if (code === 'CHAT_OPEN_FAILED') return 'The one-to-one Teams chat could not be opened or verified. The message was not sent.';
    if (code === 'TIMEOUT') return 'Recipient lookup timed out. The message was not sent.';
    if (['PROCESS_EXITED', 'PROTOCOL_ERROR', 'START_FAILED', 'CONFIRMATION_FAILED'].includes(code)) {
      return 'Teams sending could not start. The message was not sent.';
    }
    if (code === 'SHUTTING_DOWN') return 'Teams sending is unavailable while FlightDeck is closing.';
    return 'Delivery could not be confirmed. Check Teams before trying again.';
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
      setSelectedThreadId(replacementId);
      originatingThread = null;
      mobileStep = replacementId ? 'detail' : 'list';
      deleteState = { status: 'idle', message: '' };
      if (replacementId) requestAnimationFrame(() => viewRoot?.querySelector('.radar-thread-detail h2')?.focus());
      return;
    }

    setSelectedThreadId(threads.some((thread) => thread.id === request.id) ? request.id : null);
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

  async function requestScannerDeletion({ scannerId: requestedScannerId, returnFocus }) {
    const preview = await previewScannerDeletion(requestedScannerId);
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
        setSelectedThreadId(replacementId);
        originatingThread = null;
        mobileStep = replacementId ? 'detail' : 'list';
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
      const refreshedPreview = await previewScannerDeletion(currentPreview.scanner.id);
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
      const refreshedPreview = await previewScannerDeletion(currentPreview.scanner.id);
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
    setSelectedThreadId(item.id);
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
            {@const composer = $threadComposer.get(item.id)}
            {@const actionLabel = creatingEmailItemIds.has(item.id) ? 'Creating Outlook draft...'
              : composer?.status === 'generating'
              ? (composer.requestedChannel === 'teams' ? 'Drafting Teams message...' : 'Drafting email...')
              : composer?.status === 'error'
                ? (composer.requestedChannel === 'teams' ? 'Teams draft failed' : 'Email draft failed')
              : composer?.teamsSendState.status === 'sending' ? 'Sending Teams message...' : ''}
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
              {#if actionLabel}
                <span class="radar-thread__action" class:radar-thread__action--error={composer?.status === 'error' && !creatingEmailItemIds.has(item.id)}
                  role="status" data-testid="thread-action-status">
                  {#if composer?.status !== 'error' || creatingEmailItemIds.has(item.id)}
                    <span class="radar-thread__action-spinner" aria-hidden="true"></span>
                  {/if}
                  {actionLabel}
                </span>
              {/if}
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
            <p>{safeDate(mailboxActivityAt(selected), 'No activity')}</p>
          </div>
          <div class="radar-action-toolbar radar-thread-toolbar" data-testid="radar-thread-toolbar">
            <div class="radar-header-actions">
            <label class="mailbox-severity mailbox-severity-{(selected.severity || 'Observe').toLowerCase()} radar-header-pill"
              title={`Criticality: ${selected.severity || 'Observe'} — click to edit`}>
              <span aria-hidden="true">{selected.severity || 'Observe'}</span>
              <select aria-label="Criticality" value={selected.severity}
                on:change={(event) => setItemSeverity(selected.id, event.target.value)}>
                <option value="Critical">Critical</option>
                <option value="Elevated">Elevated</option>
                <option value="Observe">Observe</option>
              </select>
            </label>
            <label class="mailbox-status mailbox-status-{mailboxWorkStatusClass(selected)} radar-header-pill"
              title={`Work status: ${mailboxWorkStatus(selected)} — click to edit`}>
              <span aria-hidden="true">{mailboxWorkStatus(selected)}</span>
              <select aria-label="Work state" value={selected.lifecycleStatus}
                on:change={(event) => setItemLifecycle(selected.id, event.target.value)}>
                {#each LIFECYCLE_STATUSES as status}
                  <option value={status}>{LIFECYCLE_LABELS[status]}</option>
                {/each}
              </select>
            </label>
            {#if isMailboxUnread(selected)}
              <button type="button" class="small-btn radar-utility-button" title="Mark this item as read" on:click={() => markItemRead(selected.id)}>Read</button>
            {/if}
            </div>
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
        </header>

        <div class="radar-detail-columns">
          <section class="radar-detail-section radar-activity-panel">
            <h3>Activity</h3>
            {#if timeline.length}
              <ActivityTimeline entries={timeline} item={selected} maxVisible={5}
                canViewAction={canViewCommunication} onviewAction={viewCompletedAction} />
            {:else}
              <p>No activity recorded.</p>
            {/if}
          </section>
          <div class="radar-work-column">
        <section class="radar-detail-section radar-command-bar radar-work-panel">
          <h3>Work plan</h3>
          <div class="radar-context-block radar-context-recommendations" data-testid="scanner-recommendations">
            <h4>Recommended next moves</h4>
            {#if nextMoves.length}
              <p class="radar-next-move-hint" id="radar-next-move-hint">{workPlanCompleted
                ? 'These moves are complete. View their messages in Activity.'
                : 'Choose a next move, then draft how to move it forward.'}</p>
              <ol class="radar-next-moves" aria-label="Choose a recommended next move" aria-describedby="radar-next-move-hint">
                {#each nextMoves as step, index}
                  <li class:is-selected={selectedNextMove === step} class:is-completed={isWorkPlanStepCompleted(selected, step)}>
                    <label class="radar-next-move">
                      <input type="radio" name={`next-move-${selected.id}`} value={step}
                        checked={selectedNextMove === step} data-testid={`radar-next-move-${index}`}
                        disabled={isWorkPlanStepCompleted(selected, step) || synthesisState.status === 'generating' || teamsSendState.status === 'sending' || creatingEmailItemIds.has(selected.id)}
                        on:change={() => threadComposer.update(selected.id, { selectedNextStep: step })} />
                      <span><span data-next-move-text>{step}</span>
                        {#if isWorkPlanStepCompleted(selected, step)}<small class="radar-next-move-completed">Completed</small>{/if}
                      </span>
                    </label>
                  </li>
                {/each}
              </ol>
            {:else}
              <p>No recommended next moves yet. Draft a follow-up from this thread's context.</p>
            {/if}
            <div class="radar-plan-compose">
              <span class="radar-action-label">{workPlanCompleted ? 'All next moves completed' : nextMoves.length ? 'Draft selected next move' : 'Draft a follow-up'}</span>
              <div class="radar-action-group radar-action-group--compose" role="group" aria-label="Draft work plan message"
                aria-busy={synthesisState.threadId === selected.id && synthesisState.status === 'generating' ? 'true' : 'false'}>
                <button type="button" class="small-btn radar-action-button radar-action-button--compose" data-testid="radar-draft-email"
                  title="Draft an email for the selected next move"
                  class:is-loading={synthesisState.threadId === selected.id && synthesisState.requestedChannel === 'email' && synthesisState.status === 'generating'}
                  disabled={workPlanCompleted || synthesisState.status === 'generating' || teamsSendState.status === 'sending' || creatingEmailItemIds.has(selected.id)}
                  on:click={(event) => draftMessage('email', event.currentTarget)}>
                  {synthesisState.threadId === selected.id && synthesisState.requestedChannel === 'email' && synthesisState.status === 'generating'
                    ? 'Drafting…'
                    : 'Email'}
                </button>
                <button type="button" class="small-btn radar-action-button radar-action-button--compose" data-testid="radar-draft-teams"
                  title="Draft a Teams message for the selected next move"
                  class:is-loading={synthesisState.threadId === selected.id && synthesisState.requestedChannel === 'teams' && synthesisState.status === 'generating'}
                  disabled={workPlanCompleted || synthesisState.status === 'generating' || ['sending', 'unconfirmed'].includes(teamsSendState.status) || creatingEmailItemIds.has(selected.id)}
                  on:click={(event) => draftMessage('teams', event.currentTarget)}>
                  {synthesisState.threadId === selected.id && synthesisState.requestedChannel === 'teams' && synthesisState.status === 'generating'
                    ? 'Drafting…'
                    : 'Teams'}
                </button>
              </div>
            </div>
          </div>
          {#if viewedAction}
                <section class="radar-teams-draft radar-message-preview" data-testid="action-message-preview" aria-label="Completed message">
                  <header>
                    <div><span class="eyebrow">MESSAGE HISTORY</span>
                      <h3 tabindex="-1">{viewedAction.channel === 'teams' ? 'Teams message sent' : 'Outlook draft created'}</h3>
                    </div>
                    <span class="radar-draft-status">Read-only</span>
                  </header>
                  <dl class="radar-draft-context">
                    <div><dt>Recipient</dt><dd data-testid="action-message-recipient">{viewedAction.target || viewedMessage?.target || 'Not recorded'}</dd></div>
                    {#if viewedAction.channel === 'outlook-draft' && viewedMessage}
                      <div><dt>Subject</dt><dd data-testid="action-message-subject">{viewedMessage.sourceTitle}</dd></div>
                    {/if}
                    <div><dt>Confirmed</dt><dd>{safeDate(viewedAction.timestamp)}</dd></div>
                    {#if viewedAction.nextStep}<div><dt>Next move</dt><dd>{viewedAction.nextStep}</dd></div>{/if}
                  </dl>
                  {#if viewedMessage}
                    <pre class="radar-message-preview__body" data-testid="action-message-body">{viewedMessage.content}</pre>
                  {:else}
                    <p class="radar-change" data-testid="action-message-unavailable">The message text is not available locally. It may predate message-history storage or its saved proposal may have been deleted. Check {viewedAction.channel === 'teams' ? 'Teams' : 'Outlook Drafts'} for the original.</p>
                  {/if}
                  {#if viewedAction.channel === 'outlook-draft'}<p class="radar-change">Saved in Outlook Drafts. Nothing was sent.</p>{/if}
                  <div class="command-buttons radar-teams-draft__actions">
                    <button type="button" class="small-btn" data-testid="action-preview-close" on:click={closeActionPreview}>Close</button>
                  </div>
                </section>
          {/if}
          {#if synthesisState.threadId === selected.id && synthesisState.status === 'error'}
            <div class="radar-draft-error" role="alert" data-testid="proposal-error">
              <strong>{synthesisState.requestedChannel === 'teams' ? 'Teams' : 'Email'} draft generation failed</strong>
              <p>{synthesisState.error}</p>
              <button type="button" class="small-btn"
                disabled={teamsSendState.status === 'sending' || (synthesisState.requestedChannel === 'teams' && teamsSendState.status === 'unconfirmed')}
                on:click={(event) => draftMessage(synthesisState.requestedChannel, event.currentTarget, synthesisState.requestedNextStep)}>
                Retry {synthesisState.requestedChannel === 'teams' ? 'Teams' : 'email'} draft
              </button>
            </div>
          {/if}
          {#if synthesisState.threadId === selected.id && synthesisState.status === 'ready'
            && !synthesisState.result.proposals.length}
            <div class="radar-draft-notice" role="status" data-testid="proposal-no-communication">
              <strong>No {synthesisState.requestedChannel === 'teams' ? 'Teams' : 'email'} draft generated</strong>
              <p>{synthesisState.result.noCommunicationReason || synthesisState.result.recommendation}</p>
            </div>
          {/if}
          {#if emailProposal && !synthesisState.emailOpen && emailProposal.state !== 'Succeeded' && !isWorkPlanStepCompleted(selected, emailProposal.sourceNextStep)}
            <button type="button" class="small-btn" data-testid="radar-review-email"
              on:click={(event) => reviewEmailProposal(emailProposal.id, event.currentTarget)}>
              Review email draft
            </button>
          {/if}
          {#if emailProposal && synthesisState.emailOpen && emailProposal.state !== 'Succeeded' && !isWorkPlanStepCompleted(selected, emailProposal.sourceNextStep)}
            <EmailDraft proposalId={emailProposal.id}
              blocked={teamsSendState.status === 'sending' || (teamsSendState.status === 'unconfirmed' && teamsDraft?.nextStep && teamsDraft.nextStep === emailProposal.sourceNextStep)}
              onclose={() => threadComposer.update(selectedId, { emailOpen: false })}
              onopenActions={(event) => openEmailActions(emailProposal.id, event.currentTarget)} />
          {/if}
          {#if teamsDraft && teamsDraft.sourceItemId === selected.id && teamsSendState.status !== 'sent' && !isWorkPlanStepCompleted(selected, teamsDraft.nextStep)}
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
                  <span>Recipient name</span>
                  <input type="text" maxlength="160" autocomplete="off" placeholder="Exact Teams display name"
                    value={teamsDraft.target} disabled={['sending', 'sent', 'unconfirmed'].includes(teamsSendState.status)}
                    on:input={(event) => editTeamsDraft('target', event.target.value)} />
                  {#if !teamsDraft.target.trim() && !teamsDraft.targetEmail}
                    <small class="radar-change">Enter a verified email address or one exact Teams display name.</small>
                  {/if}
                </label>
                <label>
                  <span>Recipient email</span>
                  <input type="email" maxlength="254" autocomplete="off" placeholder="Verified email address"
                    value={teamsDraft.targetEmail || ''} disabled={['sending', 'sent', 'unconfirmed'].includes(teamsSendState.status)}
                    on:input={(event) => editTeamsDraft('targetEmail', event.target.value)} />
                  <small class="radar-change">Email identifies the recipient when supplied. Never guess an address from a name.</small>
                  {#if teamsDraft.targetEmail && !canAddressTeamsDraft(teamsDraft)}
                    <small role="alert">Enter a valid email address before sending.</small>
                  {/if}
                </label>
                <label>
                  <span>Message</span>
                  <textarea rows="7" maxlength="4000" value={teamsDraft.message}
                    disabled={['sending', 'sent', 'unconfirmed'].includes(teamsSendState.status)}
                    on:input={(event) => editTeamsDraft('message', event.target.value)}></textarea>
                </label>
              </div>
              <dl class="radar-draft-context">
                {#if teamsDraft.why}<div><dt>Why</dt><dd>{teamsDraft.why}</dd></div>{/if}
                {#if teamsDraft.risk}<div><dt>Risk</dt><dd>{teamsDraft.risk}</dd></div>{/if}
                {#if teamsDraft.reviewNote}<div><dt>Review note</dt><dd>{teamsDraft.reviewNote}</dd></div>{/if}
              </dl>
              <p class="radar-teams-draft__note">Review the recipient and message before sending. FlightDeck will ask for confirmation.</p>
              <div class="command-buttons radar-teams-draft__actions">
                <button type="button" class="small-btn primary" data-testid="teams-draft-send"
                  disabled={!canAddressTeamsDraft(teamsDraft) || creatingEmailItemIds.has(selected.id) || ['sending', 'sent', 'unconfirmed'].includes(teamsSendState.status)}
                  on:click={sendTeamsDraft}>
                  {teamsSendState.status === 'sending' ? 'Sending…' : teamsSendState.status === 'sent' ? 'Sent' : 'Send message'}
                </button>
                <button type="button" class="small-btn" data-testid="teams-draft-copy" on:click={copyTeamsDraft}>Copy message</button>
                <button type="button" class="small-btn" disabled={['sending', 'unconfirmed'].includes(teamsSendState.status)}
                  on:click={resetTeamsDraft}>Close</button>
                {#if teamsCopyStatus}<span role="status">{teamsCopyStatus}</span>{/if}
              </div>
              {#if teamsSendState.message}
                <p class="radar-change" class:radar-change--error={['error', 'unconfirmed'].includes(teamsSendState.status)}
                  role={['error', 'unconfirmed'].includes(teamsSendState.status) ? 'alert' : 'status'}
                  data-testid="teams-send-status">{teamsSendState.message}</p>
              {/if}
              {#if teamsSendState.status === 'unconfirmed'}
                <button type="button" class="small-btn" data-testid="teams-allow-retry"
                  on:click={() => threadComposer.update(selectedId, {
                    teamsSendState: { status: 'idle', message: 'Retry enabled after your Teams check. Send again only if the previous message is absent.' },
                  })}>I checked Teams; allow retry</button>
              {/if}
            </section>
          {/if}
          {#if deleteState.status === 'error'}
            <p class="radar-change" role="alert" data-testid="radar-delete-error">{deleteState.message}</p>
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
              <h4><label for="radar-done-when">Done when</label></h4>
              <textarea id="radar-done-when" class="radar-done-when" rows="3" maxlength="500"
                placeholder="Define what done looks like..."
                bind:value={() => selected.doneCriteria || '', (value) => setItemField(selected.id, 'doneCriteria', value)}></textarea>
            </div>
            <dl class="radar-context-meta">
              <div><dt>Source</dt><dd>{selected.sourceType || 'Signal'}</dd></div>
              <div>
                <dt><label for="radar-owner">Owner</label></dt>
                <dd><input id="radar-owner" type="text" maxlength="160" placeholder="Set owner"
                  bind:value={() => selected.owner || '', (value) => setItemField(selected.id, 'owner', value)} /></dd>
              </div>
              <div class="radar-context-meta__wide">
                <dt><label for="radar-due">Due date</label></dt>
                <dd><input id="radar-due" type="datetime-local"
                  bind:value={() => dueInputValue(selected.dueAt), (value) => updateDueDate(selected.id, value)} /></dd>
              </div>
              <div class="radar-context-meta__wide">
                <dt><label for="radar-item-scanner">Scanner assignment</label></dt>
                <dd><select id="radar-item-scanner"
                  bind:value={() => selected.scannerId || '', (value) => setItemField(selected.id, 'scannerId', value || null)}>
                  <option value="">Unassigned</option>
                  {#each $scanners as scanner (scanner.id)}
                    <option value={scanner.id}>{scanner.name}</option>
                  {/each}
                </select></dd>
              </div>
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
