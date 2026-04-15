<script>
  let { value = '', field = '', itemId = '', onchange, placeholder = '' } = $props();

  let editing = $state(false);
  let editValue = $state('');
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
    editValue = field === 'dueAt' ? toDatetimeLocal(value) : (value || '');
    editing = true;
  }

  function commit() {
    editing = false;
    let newValue = editValue;
    if (field === 'dueAt') {
      newValue = editValue ? new Date(editValue).toISOString() : '';
    }
    onchange?.({ itemId, field, value: newValue });
  }

  function cancel() {
    editing = false;
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      commit();
    } else if (e.key === 'Escape') {
      e.preventDefault();
      cancel();
    }
  }

  $effect(() => {
    if (editing && inputEl) {
      inputEl.focus();
    }
  });
</script>

{#if editing}
  {#if field === 'dueAt'}
    <input bind:this={inputEl} type="datetime-local" class="editable-field-input"
      bind:value={editValue} on:blur={commit} on:keydown={handleKeydown} />
  {:else}
    <input bind:this={inputEl} type="text" class="editable-field-input"
      bind:value={editValue} on:blur={commit} on:keydown={handleKeydown}
      placeholder={placeholder} />
  {/if}
{:else}
  <!-- svelte-ignore a11y_click_events_have_key_events -->
  <span class="editable-field" class:editable-field--empty={!value}
    role="button" tabindex="0" title="Click to edit"
    on:click={startEdit}
    on:keydown={(e) => e.key === 'Enter' && startEdit()}>
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
  .editable-field-input {
    background: var(--input-bg, #1e1e1e);
    color: var(--text, #ccc);
    border: 1px solid var(--accent, #0a84ff);
    border-radius: 4px;
    padding: 1px 4px;
    font-size: inherit;
    font-family: inherit;
  }
</style>
