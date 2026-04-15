<script>
  import { createEventDispatcher } from 'svelte';
  import { scanners } from '../lib/stores.js';
  import {
    SCHEDULE_INTERVAL_OPTIONS,
    WEEKLY_DAY_OPTIONS,
    DEFAULT_WEEKLY_DAYS,
    DEFAULT_WEEKLY_TIMES,
    ALL_SIGNAL_TYPES,
    SIGNAL_TYPE_OPTIONS,
  } from '../lib/constants.js';

  export let open = false;
  export let scannerId = null;

  const dispatch = createEventDispatcher();

  let title = '';
  let context = '';
  let severity = 'Observe';
  let scheduleType = 'interval';
  let scheduleValue = '30m';
  let oneTimeAt = '';
  let weeklyDays = [...DEFAULT_WEEKLY_DAYS];
  let weeklyTimes = [...DEFAULT_WEEKLY_TIMES];
  let selectedSignals = [...ALL_SIGNAL_TYPES];
  let selectedScannerId = scannerId;

  $: if (scannerId !== selectedScannerId) selectedScannerId = scannerId;

  function handleBackdrop(e) {
    if (e.target === e.currentTarget) dispatch('cancel');
  }

  function handleCreate() {
    dispatch('create', {
      title,
      context,
      severity,
      scheduleType,
      scheduleValue,
      oneTimeAt,
      weeklyDays: scheduleType === 'weekly' ? weeklyDays : undefined,
      weeklyTimes: scheduleType === 'weekly' ? weeklyTimes : undefined,
      signals: selectedSignals,
      scannerId: selectedScannerId,
    });
    // Reset form
    title = '';
    context = '';
    severity = 'Observe';
    scheduleType = 'interval';
    scheduleValue = '30m';
    oneTimeAt = '';
    weeklyDays = [...DEFAULT_WEEKLY_DAYS];
    weeklyTimes = [...DEFAULT_WEEKLY_TIMES];
    selectedSignals = [...ALL_SIGNAL_TYPES];
  }

  function handleKeydown(e) {
    if (e.key === 'Enter') {
      e.preventDefault();
      handleCreate();
    }
  }
</script>

{#if open}
  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <div class="modal show" role="dialog" aria-modal="true" on:click={handleBackdrop}>
    <div class="modal-card">
      <h3>Add Item to {$scanners.find(s => s.id === selectedScannerId)?.name || 'Radar'}</h3>
      <div class="add-task-modal-form">
        <div class="add-task-modal-row">
          <div class="add-task-field add-task-field-grow">
            <label class="add-task-label">Title</label>
            <!-- svelte-ignore a11y-autofocus -->
            <input class="tracking-input" type="text"
              placeholder="e.g., Customer agreement for Project X"
              bind:value={title} on:keydown={handleKeydown} autofocus />
          </div>
        </div>
        <div class="add-task-modal-row">
          <div class="add-task-field">
            <label class="add-task-label">Scanner</label>
            <select class="tracking-select" bind:value={selectedScannerId}>
              {#each $scanners as s}
                <option value={s.id}>{s.name || 'Unnamed'}</option>
              {/each}
            </select>
          </div>
          <div class="add-task-field">
            <label class="add-task-label">Severity</label>
            <select class="tracking-select" bind:value={severity}>
              <option value="Observe">Observe</option>
              <option value="Elevated">Elevated</option>
              <option value="Critical">Critical</option>
            </select>
          </div>
          <div class="add-task-field">
            <label class="add-task-label">Schedule</label>
            <select class="tracking-select" bind:value={scheduleType}>
              <option value="interval">Interval</option>
              <option value="weekly">Scheduled</option>
              <option value="one-time">One-time</option>
            </select>
          </div>
          {#if scheduleType === 'interval'}
            <div class="add-task-field">
              <label class="add-task-label">Interval</label>
              <select class="tracking-select" bind:value={scheduleValue}>
                {#each SCHEDULE_INTERVAL_OPTIONS as opt}
                  <option value={opt.value}>Every {opt.label}</option>
                {/each}
              </select>
            </div>
          {/if}
          {#if scheduleType === 'one-time'}
            <div class="add-task-field">
              <label class="add-task-label">Run at</label>
              <input class="tracking-input" type="datetime-local" bind:value={oneTimeAt} />
            </div>
          {/if}
        </div>

        {#if scheduleType === 'weekly'}
          <div class="add-task-modal-row">
            <div class="add-task-field">
              <label class="add-task-label">Days &amp; Times</label>
              <div class="weekly-days-row">
                {#each WEEKLY_DAY_OPTIONS as d}
                  <label class="weekly-day-label" class:active={weeklyDays.includes(d.value)}>
                    <input type="checkbox" class="weekly-day-cb" value={d.value}
                      checked={weeklyDays.includes(d.value)}
                      on:change={(e) => {
                        weeklyDays = e.target.checked
                          ? [...weeklyDays, d.value]
                          : weeklyDays.filter(v => v !== d.value);
                        if (!weeklyDays.length) weeklyDays = [d.value];
                      }} />
                    {d.label}
                  </label>
                {/each}
              </div>
              <div class="weekly-times-row">
                <label class="add-task-label">Times</label>
                <div class="weekly-time-slots">
                  {#each weeklyTimes as t, i}
                    <div class="weekly-time-slot">
                      <input type="time" class="tracking-input weekly-time-picker" value={t}
                        on:change={(e) => { weeklyTimes = weeklyTimes.map((v, idx) => idx === i ? e.target.value : v); }} />
                      {#if weeklyTimes.length > 1}
                        <button type="button" class="weekly-time-remove" title="Remove"
                          on:click={() => { weeklyTimes = weeklyTimes.filter((_, idx) => idx !== i); }}>&times;</button>
                      {/if}
                    </div>
                  {/each}
                </div>
                <button type="button" class="small-btn weekly-time-add"
                  on:click={() => { weeklyTimes = [...weeklyTimes, '09:00']; }}>+ Add</button>
              </div>
            </div>
          </div>
        {/if}

        <div class="add-task-modal-row">
          <div class="signal-filter signal-filter--flush">
            <span class="signal-filter-label">Signals:</span>
            {#each SIGNAL_TYPE_OPTIONS as opt}
              <label class="signal-checkbox" class:active={selectedSignals.includes(opt.value)}>
                <input type="checkbox" value={opt.value}
                  checked={selectedSignals.includes(opt.value)}
                  on:change={(e) => {
                    selectedSignals = e.target.checked
                      ? [...selectedSignals, opt.value]
                      : selectedSignals.filter(s => s !== opt.value);
                    if (!selectedSignals.length) selectedSignals = [opt.value];
                  }} />
                <span class="signal-icon">{opt.icon}</span>
                <span class="signal-label">{opt.label}</span>
              </label>
            {/each}
          </div>
        </div>

        <div class="add-task-modal-row">
          <div class="add-task-field add-task-field-grow">
            <label class="add-task-label">Monitoring Context</label>
            <textarea class="tracking-textarea"
              placeholder="What should WorkIQ look for when refreshing this task?"
              bind:value={context}></textarea>
          </div>
        </div>

        <div class="modal-actions">
          <button class="small-btn primary" on:click={handleCreate}>Create Task</button>
          <button class="small-btn" on:click={() => dispatch('cancel')}>Cancel</button>
        </div>
      </div>
    </div>
  </div>
{/if}
