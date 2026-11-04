<script>
  import { tick } from 'svelte';

  export let title;
  export let x;
  export let y;
  export let entries;
  export let origin;
  export let onchoose;
  export let onclose;

  let root;
  let submenu;
  let branch = null;
  let compactBranch = false;
  let parentId = null;
  const scrollPositions = new Map();
  $: visibleEntries = compactBranch && branch ? branch.children : entries;

  async function position() {
    await tick();
    if (!root) return;
    const rect = root.getBoundingClientRect();
    root.style.left = `${Math.max(8, Math.min(x, innerWidth - rect.width - 8))}px`;
    root.style.top = `${Math.max(8, Math.min(y, innerHeight - rect.height - 8))}px`;
    if (!submenu) return;
    const menuRect = root.getBoundingClientRect();
    const childRect = submenu.getBoundingClientRect();
    const right = menuRect.right - 1;
    const left = menuRect.left - childRect.width + 1;
    if (right + childRect.width > innerWidth - 8 && left < 8) {
      compactBranch = true;
      await position();
      return;
    }
    const parent = root.querySelector(`[data-menu-id="${parentId}"]`);
    submenu.style.left = `${right + childRect.width <= innerWidth - 8 ? right : left}px`;
    submenu.style.top = `${Math.max(8, Math.min(parent.getBoundingClientRect().top, innerHeight - childRect.height - 8))}px`;
  }

  async function focusFirst() {
    await position();
    root?.querySelector('[role="menuitem"]:not(:disabled)')?.focus({ preventScroll: true });
  }

  function mount(node) {
    root = node;
    for (let ancestor = origin?.parentElement; ancestor; ancestor = ancestor.parentElement) {
      scrollPositions.set(ancestor, [ancestor.scrollLeft, ancestor.scrollTop]);
    }
    const frame = requestAnimationFrame(() => { void focusFirst(); });
    return { destroy: () => cancelAnimationFrame(frame) };
  }

  async function back() {
    branch = null;
    compactBranch = false;
    await position();
    root?.querySelector(`[data-menu-id="${parentId}"]`)?.focus({ preventScroll: true });
  }

  async function openBranch(entry, focus = true) {
    parentId = entry.id;
    branch = entry;
    compactBranch = false;
    await position();
    if (focus) (submenu || root)?.querySelector('[role="menuitem"]:not(:disabled):not(.radar-context-menu__back)')?.focus({ preventScroll: true });
  }

  function hover(entry, event) {
    if (event.pointerType === 'touch' || entry.disabled) return;
    event.currentTarget.focus({ preventScroll: true });
    if (compactBranch || !entry.children || branch?.id === entry.id) return;
    const rect = root.getBoundingClientRect();
    if (rect.right + rect.width - 1 > innerWidth - 8 && rect.left - rect.width + 1 < 8) return;
    void openBranch(entry, false);
  }

  function focusEntry(entry) {
    if (!compactBranch && branch && entry.id !== parentId) branch = null;
  }

  function activate(entry) {
    if (entry.disabled) return;
    if (entry.children) {
      void openBranch(entry);
    } else {
      onchoose(entry.id);
    }
  }

  function keydown(event) {
    const activeMenu = document.activeElement?.closest('[role="menu"]') || root;
    const buttons = [...activeMenu.querySelectorAll('[role="menuitem"]:not(:disabled)')]
      .filter((button) => button.closest('[role="menu"]') === activeMenu);
    const index = buttons.indexOf(document.activeElement);
    const activeEntries = activeMenu === submenu ? branch?.children || [] : visibleEntries;
    const entry = activeEntries.find((entry) => entry.id === document.activeElement?.dataset.menuId);
    if (['ArrowDown', 'ArrowUp', 'Home', 'End'].includes(event.key)) {
      event.preventDefault();
      const next = event.key === 'Home' ? 0 : event.key === 'End' ? buttons.length - 1
        : (index + (event.key === 'ArrowDown' ? 1 : -1) + buttons.length) % buttons.length;
      buttons[next]?.focus();
    } else if (event.key === 'ArrowRight' && entry?.children) {
      event.preventDefault();
      activate(entry);
    } else if (event.key === 'ArrowLeft' && branch) {
      event.preventDefault();
      void back();
    } else if (event.key === 'Escape') {
      event.preventDefault();
      event.stopPropagation();
      if (branch) void back();
      else onclose(true);
    } else if (event.key === 'Tab') {
      onclose(true);
    }
  }

  function outside(event) {
    if (!root?.contains(event.target)) onclose(false);
  }

  function scroll(event) {
    if (root?.contains(event.target)) return;
    const target = event.target === document ? document.scrollingElement : event.target;
    const previous = scrollPositions.get(target);
    // A row can finish scrolling into view just before its contextmenu event.
    if (previous && previous[0] === target.scrollLeft && previous[1] === target.scrollTop) return;
    onclose(false);
  }
</script>

<svelte:window on:pointerdown={outside} on:resize={() => onclose(false)} />
<svelte:document on:scroll|capture={scroll} />

<div class="radar-context-menu" use:mount role="menu" aria-label={compactBranch && branch ? `${branch.label}: ${title}` : `Thread actions: ${title}`}
  on:keydown={keydown} tabindex="-1" data-testid="thread-context-menu">
  <div class="radar-context-menu__title" title={title}>{title}</div>
  {#if compactBranch && branch}
    <button type="button" role="menuitem" class="radar-context-menu__back" on:click={back}>‹ {branch.label}</button>
  {/if}
  {#each visibleEntries as entry (entry.id)}
    <button type="button" role="menuitem" data-menu-id={entry.id}
      aria-label={entry.label} aria-current={entry.current ? 'true' : undefined}
      aria-description={entry.reason || undefined}
      class:radar-context-menu__danger={entry.danger}
      disabled={entry.disabled} title={entry.reason || undefined}
      aria-haspopup={entry.children ? 'menu' : undefined}
      aria-expanded={entry.children ? branch?.id === entry.id : undefined}
      aria-controls={entry.children && branch?.id === entry.id && !compactBranch ? `thread-context-submenu-${entry.id}` : undefined}
      on:pointermove={(event) => hover(entry, event)}
      on:focus={() => focusEntry(entry)}
      on:click={() => activate(entry)}>
      <span>{entry.label}{#if entry.current}<span class="radar-context-menu__check" aria-label="Current"> ✓</span>{/if}
        {#if entry.reason}<small>{entry.reason}</small>{/if}</span>
      {#if entry.children}<span aria-hidden="true">›</span>{/if}
    </button>
  {/each}
  {#if branch && !compactBranch}
    <div class="radar-context-menu radar-context-menu__submenu" bind:this={submenu}
      id={`thread-context-submenu-${branch.id}`} role="menu" aria-label={`${branch.label}: ${title}`} tabindex="-1">
      {#each branch.children as entry (entry.id)}
        <button type="button" role="menuitem" data-menu-id={entry.id}
          aria-label={entry.label} aria-current={entry.current ? 'true' : undefined}
          aria-description={entry.reason || undefined}
          disabled={entry.disabled} title={entry.reason || undefined}
          on:pointermove={(event) => { if (!entry.disabled && event.pointerType !== 'touch') event.currentTarget.focus({ preventScroll: true }); }}
          on:click={() => activate(entry)}>
          <span>{entry.label}{#if entry.current}<span class="radar-context-menu__check" aria-label="Current"> ✓</span>{/if}
            {#if entry.reason}<small>{entry.reason}</small>{/if}</span>
        </button>
      {/each}
    </div>
  {/if}
</div>
