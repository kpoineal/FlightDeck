<script>
  let { value = '', field = '', itemId = '', onchange, placeholder = '' } = $props();

  let editing = $state(false);
  let editValue = $state('');
  let spanEl = $state(null);
  let inputEl = $state(null);

  function toDatetimeLocal(iso) {
    if (!iso) return '';
    const d = new Date(iso);
    if (!Number.isFinite(d.getTime())) return '';
    const pad = (n) => String(n).padStart(2, '0');
    return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
  }

  function formatDisplay(val) {
    if (!val) return placeholder || '';
    if (field === 'dueAt') {
      const d = new Date(val);
      return Number.isFinite(d.getTime()) ? d.toLocaleString() : val;
    }
    return val;
  }

  function startEdit() {
    if (field === 'dueAt') {
      editValue = toDatetimeLocal(value);
      editing = true;
    } else {
      editing = true;
    }
  }

  function commitInline() {
    if (!editing) return;
    editing = false;
    const newValue = spanEl ? spanEl.textContent.trim() : (value || '');
    onchange?.({ itemId, field, value: newValue });
  }

  function commitDate() {
    editing = false;
    const newValue = editValue ? new Date(editValue).toISOString() : '';
    onchange?.({ itemId, field, value: newValue });
  }

  function cancel() {
    editing = false;
    if (spanEl) spanEl.textContent = formatDisplay(value);
  }

  function handleInlineKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      spanEl?.blur();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
      spanEl?.blur();
    }
  }

  function handleDateKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commitDate();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      editing = false;
    }
  }

  $effect(() => {
    if (editing && field === 'dueAt' && inputEl) {
      inputEl.focus();
    }
    if (editing && field !== 'dueAt' && spanEl) {
      spanEl.focus();
      // Place cursor at end
      const range = document.createRange();
      const sel = window.getSelection();
      range.selectNodeContents(spanEl);
      range.collapse(false);
      sel?.removeAllRanges();
      sel?.addRange(range);
    }
  });
</script>

{#if field === 'dueAt' && editing}
  <input bind:this={inputEl} type="datetime-local" class="editable-field-input"
    bind:value={editValue} on:blur={commitDate} on:keydown={handleDateKeydown} />
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <span bind:this={spanEl}
    class="editable-field"
    class:editable-field--empty={!value && !editing}
    class:editable-field--editing={editing}
    contenteditable={editing}
    role="button" tabindex="0"
    title={editing ? '' : 'Click to edit'}
    on:click={() => !editing && startEdit()}
    on:blur={commitInline}
    on:keydown={editing ? handleInlineKeydown : (e) => e.key === 'Enter' && startEdit()}>
    {formatDisplay(value)}
  </span>
{/if}

<style>
  .editable-field {
    cursor: pointer;
    border-bottom: 1px dashed var(--text-muted, #888);
    padding: 0 2px;
  }
  .editable-field:hover {
    border-bottom-color: var(--accent, #0a84ff);
  }
  .editable-field--empty {
    opacity: 0.6;
    font-style: italic;
  }
  .editable-field--editing {
    outline: none;
    border-bottom-style: solid;
    border-bottom-color: var(--accent, #0a84ff);
    cursor: text;
    border-radius: 2px;
    box-shadow: 0 0 0 2px rgba(10, 132, 255, 0.2);
  }
  .editable-field-input {
    background: var(--input-bg, #1e1e1e);
    color: var(--text, #ccc);
    border: 1px solid var(--accent, #0a84ff);
    border-radius: 4px;
    padding: 8px 10px;
    font-size: inherit;
    font-family: inherit;
    width: 100%;
    box-sizing: border-box;
    min-width: 180px;
    line-height: 1.5;
  }
</style>
