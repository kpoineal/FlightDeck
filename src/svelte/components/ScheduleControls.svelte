<script>
  import {
    SCHEDULE_INTERVAL_OPTIONS,
    WEEKLY_DAY_OPTIONS,
    DEFAULT_WEEKLY_DAYS,
    DEFAULT_WEEKLY_TIMES,
    ALL_SIGNAL_TYPES,
    SIGNAL_TYPE_OPTIONS,
  } from '../lib/constants.js';

  let { item, onchange, onrunnow } = $props();

  let scheduleType = $derived(item.scheduleType === 'one-time' ? 'one-time'
    : item.scheduleType === 'weekly' ? 'weekly'
    : 'interval');
  let scheduleValue = $derived(item.scheduleValue || '30m');
  let monitorEnabled = $derived(item.monitorEnabled !== false);
  let notifyEnabled = $derived(item.notifyEnabled !== false);
  let workHoursOnly = $derived(item.workHoursOnly === true);
  let oneTimeAt = $derived(item.oneTimeAt ? item.oneTimeAt.slice(0, 16) : '');
  let weeklyDays = $derived(Array.isArray(item.weeklyDays) ? item.weeklyDays : [...DEFAULT_WEEKLY_DAYS]);
  let weeklyTimes = $derived(Array.isArray(item.weeklyTimes) ? item.weeklyTimes : [...DEFAULT_WEEKLY_TIMES]);
  let activeSignals = $derived(Array.isArray(item.monitorSignals) ? item.monitorSignals : [...ALL_SIGNAL_TYPES]);
  let isInterval = $derived(scheduleType !== 'one-time' && scheduleType !== 'weekly');

  function emitChange(field, value) {
    onchange?.({ itemId: item.id, field, value });
  }
</script>

<div class="tracking-inline">
  <label>
    <input type="checkbox" checked={monitorEnabled}
      on:change={(e) => emitChange('monitorEnabled', e.target.checked)} /> Enabled
  </label>
  <label>
    <input type="checkbox" checked={notifyEnabled}
      on:change={(e) => emitChange('notifyEnabled', e.target.checked)} /> Notifications
  </label>
  {#if isInterval}
    <label title="When enabled, interval checks only run between 8:00 AM and 5:00 PM local time.">
      <input type="checkbox" checked={workHoursOnly}
        on:change={(e) => emitChange('workHoursOnly', e.target.checked)} /> Work Hours
    </label>
  {/if}

  <select class="tracking-select" value={scheduleType}
    on:change={(e) => emitChange('scheduleType', e.target.value)}>
    <option value="interval">Interval</option>
    <option value="weekly">Scheduled</option>
    <option value="one-time">One-time</option>
  </select>

  {#if isInterval}
    <select class="tracking-select" value={scheduleValue}
      on:change={(e) => emitChange('scheduleValue', e.target.value)}>
      {#each SCHEDULE_INTERVAL_OPTIONS as opt}
        <option value={opt.value}>Every {opt.label}</option>
      {/each}
    </select>
  {/if}

  {#if scheduleType === 'one-time'}
    <input class="tracking-input" type="datetime-local" value={oneTimeAt}
      on:change={(e) => emitChange('oneTimeAt', e.target.value)} />
  {/if}

  <button class="small-btn" on:click={() => onrunnow?.({ itemId: item.id })}>Run check now</button>
</div>

{#if scheduleType === 'weekly'}
  <div class="weekly-schedule-panel">
    <div class="weekly-days-row">
      {#each WEEKLY_DAY_OPTIONS as d}
        <label class="weekly-day-label" class:active={weeklyDays.includes(d.value)}>
          <input type="checkbox" class="weekly-day-cb" value={d.value}
            checked={weeklyDays.includes(d.value)}
            on:change={(e) => {
              const newDays = e.target.checked
                ? [...weeklyDays, d.value]
                : weeklyDays.filter(v => v !== d.value);
              if (newDays.length) emitChange('weeklyDays', newDays);
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
              on:change={(e) => {
                const newTimes = [...weeklyTimes];
                newTimes[i] = e.target.value;
                emitChange('weeklyTimes', newTimes.filter(Boolean));
              }} />
            {#if weeklyTimes.length > 1}
              <button type="button" class="weekly-time-remove" title="Remove"
                on:click={() => {
                  const newTimes = weeklyTimes.filter((_, idx) => idx !== i);
                  emitChange('weeklyTimes', newTimes);
                }}>&times;</button>
            {/if}
          </div>
        {/each}
      </div>
      <button type="button" class="small-btn weekly-time-add"
        on:click={() => emitChange('weeklyTimes', [...weeklyTimes, '09:00'])}>+ Add</button>
    </div>
  </div>
{/if}

<div class="signal-filter">
  <span class="signal-filter-label">Signals:</span>
  {#each SIGNAL_TYPE_OPTIONS as opt}
    <label class="signal-checkbox" class:active={activeSignals.includes(opt.value)}>
      <input type="checkbox" value={opt.value}
        checked={activeSignals.includes(opt.value)}
        on:change={(e) => {
          const newSignals = e.target.checked
            ? [...activeSignals, opt.value]
            : activeSignals.filter(s => s !== opt.value);
          if (newSignals.length) emitChange('monitorSignals', newSignals);
        }} />
      <span class="signal-icon">{opt.icon}</span>
      <span class="signal-label">{opt.label}</span>
    </label>
  {/each}
</div>
