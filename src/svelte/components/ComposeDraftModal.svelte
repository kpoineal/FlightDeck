<script>
  import { showToast } from './Toast.svelte';

  let { open = false, oncancel, oncreated } = $props();

  let step = $state('compose');
  let to = $state('');
  let cc = $state('');
  let bcc = $state('');
  let subject = $state('');
  let body = $state('');
  let importance = $state('normal');
  let submitting = $state(false);
  let error = $state('');
  let wasOpen = false;
  let modalCard = $state(null);
  let reviewHeading = $state(null);

  let draft = $derived({
    to: parseRecipients(to),
    cc: parseRecipients(cc),
    bcc: parseRecipients(bcc),
    subject: subject.trim(),
    body,
    importance,
  });
  let canReview = $derived(draft.to.length > 0 && draft.subject.length > 0 && body.trim().length > 0);

  $effect(() => {
    if (open && !wasOpen) reset();
    wasOpen = open;
  });

  function parseRecipients(value) {
    return value
      .split(/[;,\n]/)
      .map((entry) => entry.trim())
      .filter(Boolean);
  }

  function reset() {
    step = 'compose';
    to = '';
    cc = '';
    bcc = '';
    subject = '';
    body = '';
    importance = 'normal';
    submitting = false;
    error = '';
  }

  function close() {
    if (!submitting) oncancel?.();
  }

  function focusableElements() {
    if (!modalCard) return [];
    return [...modalCard.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((element) => element.getClientRects().length > 0);
  }

  function handleKeydown(event) {
    if (event.key === 'Escape' && !submitting) {
      event.preventDefault();
      close();
      return;
    }
    if (event.key !== 'Tab') return;

    const focusable = focusableElements();
    if (focusable.length === 0) {
      event.preventDefault();
      return;
    }

    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    const activeIndex = focusable.indexOf(document.activeElement);
    if (activeIndex === -1) {
      event.preventDefault();
      (event.shiftKey ? last : first).focus();
    } else if (event.shiftKey && document.activeElement === first) {
      event.preventDefault();
      last.focus();
    } else if (!event.shiftKey && document.activeElement === last) {
      event.preventDefault();
      first.focus();
    }
  }

  function handleBackdrop(event) {
    if (event.target === event.currentTarget) close();
  }

  function showReview() {
    if (!canReview) return;
    error = '';
    step = 'review';
    requestAnimationFrame(() => reviewHeading?.focus());
  }

  function errorMessage(code) {
    if (code === 'AUTH_REQUIRED') return 'Sign in to WorkIQ, then try creating the draft again.';
    if (code === 'INVALID_DRAFT') return 'Check the recipient addresses and draft fields.';
    if (code === 'UNSUPPORTED') return 'This WorkIQ version cannot create Outlook drafts.';
    if (code === 'TIMEOUT') return 'WorkIQ took too long to create the draft. Check Outlook before retrying.';
    if (code === 'CANCELLED') return 'Draft creation was cancelled.';
    return 'The Outlook draft could not be created.';
  }

  async function createDraft() {
    if (submitting || !window.workiq || typeof window.workiq.createOutlookDraft !== 'function') {
      error = 'Outlook draft creation is unavailable.';
      return;
    }

    submitting = true;
    error = '';
    try {
      const result = await window.workiq.createOutlookDraft(draft);
      if (!result?.ok) {
        error = errorMessage(result?.code);
        return;
      }

      showToast('Draft created in Outlook');
      oncreated?.();
    } catch (_) {
      error = 'The Outlook draft could not be created.';
    } finally {
      submitting = false;
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <div class="modal show" role="dialog" aria-modal="true" aria-labelledby="compose-draft-title"
    tabindex="-1" on:click={handleBackdrop} on:keydown={handleKeydown}>
    <div class="modal-card compose-draft-modal" bind:this={modalCard}>
      <header class="compose-draft-header">
        <div>
          <span>Outlook</span>
          <h3 id="compose-draft-title" tabindex="-1" bind:this={reviewHeading}>
            {step === 'compose' ? 'New draft' : 'Review draft'}
          </h3>
        </div>
        <span class="compose-draft-status">Draft only</span>
      </header>

      {#if step === 'compose'}
        <div class="compose-draft-form">
          <label>
            <span>To</span>
            <!-- svelte-ignore a11y_autofocus -->
            <input class="tracking-input" type="text" bind:value={to}
              placeholder="name@example.com" autocomplete="off" autofocus />
          </label>
          <div class="compose-draft-recipient-row">
            <label>
              <span>Cc</span>
              <input class="tracking-input" type="text" bind:value={cc}
                placeholder="Optional" autocomplete="off" />
            </label>
            <label>
              <span>Bcc</span>
              <input class="tracking-input" type="text" bind:value={bcc}
                placeholder="Optional" autocomplete="off" />
            </label>
          </div>
          <div class="compose-draft-subject-row">
            <label>
              <span>Subject</span>
              <input class="tracking-input" type="text" maxlength="500" bind:value={subject} />
            </label>
            <label class="compose-draft-importance">
              <span>Importance</span>
              <select class="tracking-input" bind:value={importance}>
                <option value="low">Low</option>
                <option value="normal">Normal</option>
                <option value="high">High</option>
              </select>
            </label>
          </div>
          <label>
            <span>Message</span>
            <textarea class="tracking-textarea compose-draft-body" maxlength="100000"
              bind:value={body}></textarea>
          </label>
          <p class="compose-draft-note">Recipients may be separated with commas or semicolons.</p>
        </div>

        <div class="modal-actions">
          <button type="button" class="small-btn" on:click={close}>Cancel</button>
          <button type="button" class="small-btn primary" disabled={!canReview}
            on:click={showReview}>Review draft</button>
        </div>
      {:else}
        <div class="compose-draft-review">
          <dl>
            <div><dt>To</dt><dd>{draft.to.join(', ')}</dd></div>
            {#if draft.cc.length}<div><dt>Cc</dt><dd>{draft.cc.join(', ')}</dd></div>{/if}
            {#if draft.bcc.length}<div><dt>Bcc</dt><dd>{draft.bcc.join(', ')}</dd></div>{/if}
            <div><dt>Importance</dt><dd>{importance}</dd></div>
            <div><dt>Subject</dt><dd>{draft.subject}</dd></div>
          </dl>
          <div class="compose-draft-review-body">{body}</div>
          <p class="compose-draft-note">This creates a saved Outlook draft. It will not send the message.</p>
          {#if error}<p class="compose-draft-error" role="alert">{error}</p>{/if}
        </div>

        <div class="modal-actions">
          <button type="button" class="small-btn" disabled={submitting} on:click={close}>Cancel</button>
          <button type="button" class="small-btn" disabled={submitting}
            on:click={() => { error = ''; step = 'compose'; }}>Edit</button>
          <button type="button" class="small-btn primary" class:is-loading={submitting}
            disabled={submitting} on:click={createDraft}>
            {submitting ? 'Creating...' : 'Create Outlook draft'}
          </button>
        </div>
      {/if}
    </div>
  </div>
{/if}