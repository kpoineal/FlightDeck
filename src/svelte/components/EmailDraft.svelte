<script>
  import { actionProposals } from '../lib/stores.js';
  import { buildOutlookDraftPayload, updateActionProposal } from '../lib/action-proposals.js';
  import { createOutlookDraftProposal } from '../lib/outlook-draft.js';

  let { proposalId, onclose, blocked = false } = $props();
  let proposal = $derived($actionProposals.find((entry) => entry.id === proposalId));
  let editable = $derived(canEdit(proposal));
  let creating = $derived(proposal?.state === 'Executing');
  let canCreate = $derived(proposal && !blocked && !proposal.archivedAt && !proposal.auditOnly
    && ['Drafted', 'Awaiting review', 'Approved', 'Queued', 'Failed'].includes(proposal.state)
    && proposal.executionCode !== 'ACTION_UNCONFIRMED' && buildOutlookDraftPayload(proposal).ok);

  function canEdit(entry) {
    return entry && !entry.archivedAt && !entry.auditOnly && entry.executionCode !== 'ACTION_UNCONFIRMED' && (entry.state === 'Drafted'
      || (entry.dispatchStatus === 'not-dispatched' && (entry.state === 'Failed'
        || (entry.state === 'Queued' && entry.executionCode === 'CANCELLED'))));
  }

  function edit(field, value) {
    actionProposals.update((entries) => entries.map((entry) => {
      if (entry.id !== proposalId || !canEdit(entry)) return entry;
      const draft = entry.state === 'Drafted' ? entry : {
        ...entry, state: 'Drafted', outcome: null, executionCode: null,
        executionVerification: null, dispatchStatus: 'not-started',
      };
      const updated = updateActionProposal(draft, { [field]: value });
      return updated === entry ? entry : { ...updated, [field]: value };
    }));
  }
</script>

{#if proposal}
  <section class="radar-teams-draft" data-testid="email-draft-editor" aria-label="Email draft">
    <header>
      <div><span class="eyebrow">EMAIL DRAFT</span><h3>Review and create</h3></div>
      <span class="radar-draft-status">{creating ? 'Creating...' : proposal.state === 'Succeeded' ? 'Saved' : proposal.state}</span>
    </header>
    <div class="radar-teams-draft__fields">
      <label>
        <span>Recipient email</span>
        <input type="text" data-testid="email-draft-recipient" maxlength="12800" autocomplete="off"
          placeholder="Verified email address" value={proposal.target} disabled={!editable}
          on:input={(event) => edit('target', event.currentTarget.value)} />
        <small>Use verified email addresses. Separate multiple recipients with semicolons.</small>
      </label>
      <label>
        <span>Subject</span>
        <input type="text" data-testid="email-draft-subject" maxlength="500" value={proposal.sourceTitle}
          disabled={!editable} on:input={(event) => edit('sourceTitle', event.currentTarget.value)} />
      </label>
      <label class="radar-draft-message">
        <span>Message</span>
        <textarea rows="7" maxlength="100000" data-testid="email-draft-message" value={proposal.content}
          disabled={!editable} on:input={(event) => edit('content', event.currentTarget.value)}></textarea>
      </label>
    </div>
    <dl class="radar-draft-context">
      {#if proposal.reason}<div><dt>Why</dt><dd>{proposal.reason}</dd></div>{/if}
      {#if proposal.risk}<div><dt>Risk / review note</dt><dd>{proposal.risk}</dd></div>{/if}
    </dl>
    <p class="radar-teams-draft__note">Review the recipient, subject, and message. FlightDeck will ask for confirmation before saving an Outlook draft. Nothing is sent.</p>
    {#if editable && !buildOutlookDraftPayload(proposal).ok}
      <p class="radar-change" role="alert">Enter valid recipient email addresses, a subject, and a message before creating the draft.</p>
    {/if}

    <div class="command-buttons radar-teams-draft__actions">
      <button type="button" class="small-btn primary" data-testid="email-draft-create"
        disabled={!canCreate || creating}
        on:click={() => createOutlookDraftProposal(proposalId, { reviewed: true, createDraft: window.workiq?.createOutlookDraft })}>
        {creating ? 'Creating Outlook draft...' : proposal.state === 'Succeeded' ? 'Outlook draft saved' : 'Create Outlook draft'}
      </button>
      <button type="button" class="small-btn" disabled={creating} on:click={onclose}>Close</button>
    </div>
    {#if proposal.outcome}
      <p class="radar-change" role={proposal.state === 'Failed' ? 'alert' : 'status'} data-testid="email-draft-status">{proposal.outcome}</p>
    {/if}
  </section>
{/if}
