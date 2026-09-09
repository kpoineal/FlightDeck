<script>
  let {
    open = false,
    preview = null,
    status = 'idle',
    message = '',
    returnFocus = null,
    onconfirm,
    oncancel,
  } = $props();

  let dialog = $state(null);
  let disposition = $state('reassign');
  let targetScannerId = $state(null);
  let destructiveConfirmed = $state(false);
  let focusOrigin = null;
  let previewToken = null;
  let wasOpen = false;

  let mutationDisabled = $derived(status === 'submitting' || status === 'recovery');
  let confirmDisabled = $derived(
    mutationDisabled || (disposition === 'delete-all' && !destructiveConfirmed)
  );

  $effect(() => {
    const nextPreviewToken = open ? preview?.previewToken : null;
    if (open && (!wasOpen || nextPreviewToken !== previewToken)) {
      if (!wasOpen) focusOrigin = returnFocus || document.activeElement;
      disposition = 'reassign';
      targetScannerId = null;
      destructiveConfirmed = false;
      previewToken = nextPreviewToken;
      requestAnimationFrame(() => dialog?.querySelector('[data-testid="scanner-deletion-cancel"]')?.focus());
    }
    if (!open && wasOpen) {
      const target = focusOrigin;
      focusOrigin = null;
      queueMicrotask(() => {
        if (target?.isConnected && !target.disabled && target.getClientRects().length) target.focus();
      });
    }
    wasOpen = open;
  });

  $effect(() => {
    if (disposition !== 'delete-all') destructiveConfirmed = false;
  });

  function requestClose() {
    if (!mutationDisabled) oncancel?.();
  }

  function handleBackdrop(event) {
    if (event.target === event.currentTarget) requestClose();
  }

  function handleKeydown(event) {
    if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      requestClose();
      return;
    }
    if (event.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), select:not([disabled]), [tabindex]:not([tabindex="-1"])'
    )].filter((element) => element.getClientRects().length && element.getAttribute('aria-hidden') !== 'true');
    if (!focusable.length) {
      event.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!focusable.includes(document.activeElement)) {
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

  function confirmDeletion() {
    if (confirmDisabled || !preview?.previewToken) return;
    onconfirm?.({
      disposition,
      targetScannerId: disposition === 'reassign' ? targetScannerId : null,
      previewToken: preview.previewToken,
    });
  }
</script>

{#if open && preview}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="modal show" role="dialog" aria-modal="true"
    aria-labelledby="scanner-deletion-title" aria-describedby="scanner-deletion-summary"
    aria-busy={status === 'submitting' ? 'true' : 'false'}
    data-testid="scanner-deletion-modal" tabindex="-1" bind:this={dialog}
    on:click={handleBackdrop} on:keydown={handleKeydown}>
    <div class="modal-card scanner-deletion-modal">
      <header class="scanner-deletion-modal__header">
        <span class="eyebrow">SCANNER IMPACT</span>
        <h3 id="scanner-deletion-title">Delete {preview.scanner.name}?</h3>
        <p id="scanner-deletion-summary">
          Review what belongs to this scanner, then choose whether to keep or remove its threads.
        </p>
      </header>

      <dl class="scanner-deletion-impact" aria-label="Scanner impact summary">
        <div><dt>Current Inbox threads</dt><dd>{preview.counts.hotItems}</dd></div>
        <div><dt>Archived threads</dt><dd>{preview.counts.coldItems}</dd></div>
        <div><dt>Linked proposed actions</dt><dd>{preview.counts.linkedProposals}</dd></div>
        <div><dt>Actions with evidence</dt><dd>{preview.counts.effectfulProposals}</dd></div>
        <div><dt>Action records kept</dt><dd>{preview.counts.audits}</dd></div>
        <div><dt>Unique threads affected</dt><dd>{preview.counts.uniqueItems}</dd></div>
      </dl>

      <fieldset class="scanner-deletion-choices" disabled={mutationDisabled}>
        <legend>Choose what happens to the threads</legend>
        <label class="scanner-deletion-choice" class:selected={disposition === 'reassign'}>
          <input type="radio" name="scanner-deletion-disposition" value="reassign" bind:group={disposition} />
          <span>
            <strong>Keep and reassign</strong>
            <small>Keep all threads, proposed actions, and recorded action evidence.</small>
          </span>
        </label>
        {#if disposition === 'reassign'}
          <label class="scanner-deletion-destination">
            <span>Move threads to</span>
            <select bind:value={targetScannerId} data-testid="scanner-deletion-target">
              {#each preview.reassignmentTargets as target (target.id)}
                <option value={target.id}>{target.name}</option>
              {/each}
            </select>
          </label>
        {/if}

        <label class="scanner-deletion-choice scanner-deletion-choice--danger"
          class:selected={disposition === 'delete-all'}>
          <input type="radio" name="scanner-deletion-disposition" value="delete-all" bind:group={disposition} />
          <span>
            <strong>Delete all</strong>
            <small>Permanently remove {preview.counts.uniqueItems} threads and {preview.counts.noEffectProposals} unexecuted proposed actions.</small>
          </span>
        </label>
      </fieldset>

      {#if disposition === 'delete-all'}
        <section class="scanner-deletion-warning" aria-label="Permanent deletion warning">
          <strong>This cannot be undone.</strong>
          <p>
            {preview.counts.tombstones} {preview.counts.tombstones === 1 ? 'thread' : 'threads'} will be removed and blocked from returning in future scans.
            Evidence for completed or uncertain actions will remain in Activity.
          </p>
          <label>
            <input type="checkbox" bind:checked={destructiveConfirmed} disabled={mutationDisabled}
              data-testid="scanner-deletion-acknowledgement" />
            <span>I understand that these threads will be permanently deleted.</span>
          </label>
        </section>
      {/if}

      {#if message}
        <p class="scanner-deletion-status" class:recovery={status === 'recovery'}
          role={status === 'error' || status === 'recovery' ? 'alert' : 'status'}>{message}</p>
      {/if}

      <div class="modal-actions scanner-deletion-modal__actions">
        <button type="button" class="small-btn" data-testid="scanner-deletion-cancel"
          disabled={status === 'submitting'} on:click={requestClose}>Cancel</button>
        <button type="button" class="small-btn" class:primary={disposition === 'reassign'}
          class:warn={disposition === 'delete-all'} data-testid="scanner-deletion-confirm"
          disabled={confirmDisabled} on:click={confirmDeletion}>
          {status === 'submitting'
            ? 'Saving...'
            : disposition === 'delete-all'
              ? 'Permanently delete'
              : 'Delete scanner and reassign'}
        </button>
      </div>
    </div>
  </div>
{/if}