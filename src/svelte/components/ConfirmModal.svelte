<script>
  let {
    open = false,
    title = 'Confirm Action',
    summary = '',
    targets = '',
    confirmLabel = 'Confirm',
    acknowledgementLabel = '',
    returnFocus = null,
    onconfirm,
    oncancel,
  } = $props();
  let dialog = $state(null);
  let focusOrigin = null;
  let wasOpen = false;
  let acknowledged = $state(false);

  $effect(() => {
    if (open && !wasOpen) {
      focusOrigin = returnFocus || document.activeElement;
      acknowledged = false;
      requestAnimationFrame(() => dialog?.querySelector('[data-testid="confirm-cancel"]')?.focus());
    }
    wasOpen = open;
  });

  function closeWith(callback) {
    const target = focusOrigin;
    focusOrigin = null;
    callback?.();
    queueMicrotask(() => {
      if (target?.isConnected && !target.disabled && target.getClientRects().length) target.focus();
    });
  }

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) closeWith(oncancel);
  }

  function focusOnMount(node) {
    node.focus();
  }

  function handleKeydown(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      e.stopPropagation();
      closeWith(oncancel);
      return;
    }
    if (e.key !== 'Tab') return;
    const focusable = [...dialog.querySelectorAll(
      'button:not([disabled]), input:not([disabled]), textarea:not([disabled]), select:not([disabled]), a[href], [tabindex]:not([tabindex="-1"])'
    )].filter((element) => element.getClientRects().length && element.getAttribute('aria-hidden') !== 'true');
    if (!focusable.length) {
      e.preventDefault();
      dialog.focus();
      return;
    }
    const first = focusable[0];
    const last = focusable[focusable.length - 1];
    if (!focusable.includes(document.activeElement)) {
      e.preventDefault();
      (e.shiftKey ? last : first).focus();
    } else if (e.shiftKey && document.activeElement === first) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && document.activeElement === last) {
      e.preventDefault();
      first.focus();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="modal show" role="dialog" aria-modal="true" aria-labelledby="confirm-action-title"
    aria-describedby="confirm-action-summary"
    data-testid="confirm-modal" tabindex="-1" bind:this={dialog}
    on:click={handleBackdrop} on:keydown={handleKeydown}>
    <div class="modal-card">
      <h3 id="confirm-action-title">{title}</h3>
      <p id="confirm-action-summary" class="panel-sub">{summary}</p>
      <div class="confirm-targets">{targets}</div>
      {#if acknowledgementLabel}
        <label class="confirm-acknowledgement">
          <input type="checkbox" data-testid="confirm-acknowledgement" bind:checked={acknowledged} />
          <span>{acknowledgementLabel}</span>
        </label>
      {/if}
      <div class="modal-actions">
        <button class="small-btn" data-testid="confirm-cancel" use:focusOnMount on:click={() => closeWith(oncancel)}>Cancel</button>
        <button class="small-btn warn" data-testid="confirm-submit"
          disabled={Boolean(acknowledgementLabel) && !acknowledged}
          on:click={() => closeWith(onconfirm)}>{confirmLabel}</button>
      </div>
    </div>
  </div>
{/if}
