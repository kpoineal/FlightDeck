<script>
  let { prompt = '', title = 'Edit Prompt', onapply, onreset } = $props();

  let open = $state(false);
  let editedPrompt = $state(prompt);

  $effect(() => { editedPrompt = prompt; });

  function handleApply() {
    onapply?.({ prompt: editedPrompt });
  }

  function handleReset() {
    onreset?.();
  }
</script>

<details class="prompt-editor" bind:open>
  <summary class="prompt-editor-toggle">
    <span class="chevron">{open ? '▼' : '▶'}</span> {title}
  </summary>
  <div class="prompt-editor-body">
    <textarea
      spellcheck="false"
      placeholder="Loading prompt..."
      bind:value={editedPrompt}
    ></textarea>
    <div class="prompt-editor-actions">
      <button class="small-btn primary" on:click={handleApply}>Apply</button>
      <button class="small-btn" on:click={handleReset}>Reset to Default</button>
    </div>
  </div>
</details>
