<script>
  import { createEventDispatcher } from 'svelte';
  import {
    SCHEDULE_INTERVAL_OPTIONS,
    WEEKLY_DAY_OPTIONS,
    DEFAULT_WEEKLY_DAYS,
    DEFAULT_WEEKLY_TIMES,
    ALL_SIGNAL_TYPES,
    SIGNAL_TYPE_OPTIONS,
    NOTIFICATION_MODE_OPTIONS,
    SEVERITY_THRESHOLD_OPTIONS,
    MISSED_RUN_POLICY_OPTIONS,
    DEDUP_STRATEGY_OPTIONS,
    DEFAULT_SCANNER_PROMPT,
  } from '../lib/constants.js';

  export let scanner = null;

  const dispatch = createEventDispatcher();

  $: isEdit = scanner != null;

  let name = isEdit ? (scanner.name || '') : '';
  let prompt = isEdit ? (scanner.prompt || '') : '';
  let scheduleType = (isEdit && scanner.scheduleType) || 'interval';
  let scheduleValue = (isEdit && scanner.scheduleValue) || '30m';
  let workHoursOnly = isEdit ? scanner.workHoursOnly === true : false;
  let autoMonitorNewItems = isEdit ? scanner.autoMonitorNewItems === true : false;
  let notificationMode = (isEdit && scanner.notificationMode) || 'all';
  let signalTypes = isEdit && Array.isArray(scanner.signalTypes) ? [...scanner.signalTypes] : [...ALL_SIGNAL_TYPES];
  let crossScannerDedup = isEdit ? scanner.crossScannerDedup !== false : true;
  let autoMonitorSeverityThreshold = (isEdit && scanner.autoMonitorSeverityThreshold) || 'all';
  let maxItemsPerScan = isEdit ? (scanner.maxItemsPerScan || 10) : 10;
  let runOnStartup = isEdit ? scanner.runOnStartup === true : false;
  let missedRunPolicy = (isEdit && scanner.missedRunPolicy) || 'run-once';
  let dedupStrategy = (isEdit && scanner.dedupStrategy) || 'evidence-url';
  let excludeKeywords = isEdit && Array.isArray(scanner.excludeKeywords) ? scanner.excludeKeywords.join(', ') : '';
  let defaultMonitorSchedule = (isEdit && scanner.defaultMonitorSchedule) || '30m';
  let defaultMonitorScheduleType = (isEdit && scanner.defaultMonitorScheduleType) || 'interval';
  let defaultMonitorWorkHoursOnly = isEdit ? scanner.defaultMonitorWorkHoursOnly === true : false;
  let defaultMonitorNotifyEnabled = isEdit ? scanner.defaultMonitorNotifyEnabled !== false : true;
  let defaultMonitorSignals = isEdit && Array.isArray(scanner.defaultMonitorSignals) ? [...scanner.defaultMonitorSignals] : [...ALL_SIGNAL_TYPES];
  let autoArchiveAfterDays = isEdit ? (scanner.autoArchiveAfterDays || 0) : 0;
  let retentionDays = isEdit ? (scanner.retentionDays || 365) : 365;
  let webhookUrl = isEdit ? (scanner.webhookUrl || '') : '';
  let scannerGroupId = isEdit ? (scanner.scannerGroupId || '') : '';

  let weeklyDays = isEdit && Array.isArray(scanner.weeklyDays) ? [...scanner.weeklyDays] : [...DEFAULT_WEEKLY_DAYS];
  let weeklyTimes = isEdit && Array.isArray(scanner.weeklyTimes) ? [...scanner.weeklyTimes] : [...DEFAULT_WEEKLY_TIMES];
  let defaultMonitorWeeklyDays = isEdit && Array.isArray(scanner.defaultMonitorWeeklyDays) ? [...scanner.defaultMonitorWeeklyDays] : [...DEFAULT_WEEKLY_DAYS];
  let defaultMonitorWeeklyTimes = isEdit && Array.isArray(scanner.defaultMonitorWeeklyTimes) ? [...scanner.defaultMonitorWeeklyTimes] : [...DEFAULT_WEEKLY_TIMES];

  function collectValues() {
    return {
      name: name.trim(),
      prompt: prompt.trim(),
      scheduleType,
      scheduleValue,
      workHoursOnly,
      autoMonitorNewItems,
      notificationMode,
      signalTypes: signalTypes.length ? signalTypes : [...ALL_SIGNAL_TYPES],
      crossScannerDedup,
      autoMonitorSeverityThreshold,
      maxItemsPerScan: Number(maxItemsPerScan) || 10,
      runOnStartup,
      missedRunPolicy,
      dedupStrategy,
      excludeKeywords: excludeKeywords.split(',').map(s => s.trim()).filter(Boolean),
      defaultMonitorSchedule,
      defaultMonitorScheduleType,
      defaultMonitorWorkHoursOnly,
      defaultMonitorNotifyEnabled,
      defaultMonitorSignals: defaultMonitorSignals.length ? defaultMonitorSignals : [...ALL_SIGNAL_TYPES],
      autoArchiveAfterDays: Number(autoArchiveAfterDays) || 0,
      retentionDays: Number(retentionDays) || 365,
      webhookUrl: webhookUrl.trim(),
      scannerGroupId: scannerGroupId.trim(),
      weeklyDays: scheduleType === 'weekly' ? weeklyDays : undefined,
      weeklyTimes: scheduleType === 'weekly' ? weeklyTimes : undefined,
      defaultMonitorWeeklyDays: defaultMonitorScheduleType === 'weekly' ? defaultMonitorWeeklyDays : undefined,
      defaultMonitorWeeklyTimes: defaultMonitorScheduleType === 'weekly' ? defaultMonitorWeeklyTimes : undefined,
    };
  }

  function toggleSignal(arr, value) {
    const idx = arr.indexOf(value);
    if (idx >= 0) {
      if (arr.length > 1) return arr.filter(v => v !== value);
      return arr;
    }
    return [...arr, value];
  }
</script>

<div class="scanner-form">
  <div class="scanner-form-row">
    <div class="scanner-form-field scanner-form-field-grow">
      <label class="scanner-form-label">Name</label>
      <input class="tracking-input" type="text" placeholder="e.g., Competitor Intel" bind:value={name} />
    </div>
    <div class="scanner-form-field">
      <label class="scanner-form-label">Schedule</label>
      <select class="tracking-select" bind:value={scheduleType}>
        <option value="interval">Interval</option>
        <option value="weekly">Scheduled</option>
        <option value="one-time">One-time</option>
      </select>
    </div>
    {#if scheduleType === 'interval'}
      <div class="scanner-form-field">
        <label class="scanner-form-label">Interval</label>
        <select class="tracking-select" bind:value={scheduleValue}>
          {#each SCHEDULE_INTERVAL_OPTIONS as opt}
            <option value={opt.value}>Every {opt.label}</option>
          {/each}
        </select>
      </div>
    {/if}
  </div>

  {#if scheduleType === 'weekly'}
    <div class="scanner-form-row">
      <div class="scanner-form-field scanner-form-field-grow">
        <label class="scanner-form-label">Days &amp; Times</label>
        <div class="weekly-days-row">
          {#each WEEKLY_DAY_OPTIONS as d}
            <label class="weekly-day-label" class:active={weeklyDays.includes(d.value)}>
              <input type="checkbox" class="weekly-day-cb" value={d.value}
                checked={weeklyDays.includes(d.value)}
                on:change={(e) => {
                  weeklyDays = e.target.checked
                    ? [...weeklyDays, d.value]
                    : weeklyDays.filter(v => v !== d.value) || weeklyDays;
                  if (!weeklyDays.length) weeklyDays = [d.value];
                }} />
              {d.label}
            </label>
          {/each}
        </div>
        <div class="weekly-times-row">
          <label class="scanner-form-label">Times</label>
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

  <div class="scanner-form-row">
    <div class="scanner-form-field scanner-form-field-grow">
      <label class="scanner-form-label">Prompt</label>
      <textarea class="tracking-textarea" placeholder="What should this scanner look for?" bind:value={prompt}></textarea>
    </div>
  </div>

  <div class="scanner-form-section-label">Options</div>
  <div class="scanner-form-row scanner-form-options">
    <div class="scanner-form-field">
      <label class="scanner-form-label">Signal Types</label>
      <div class="scanner-signal-types">
        {#each SIGNAL_TYPE_OPTIONS as s}
          <label class="scanner-signal-label" class:active={signalTypes.includes(s.value)}>
            <input type="checkbox" class="scanner-signal-cb" value={s.value}
              checked={signalTypes.includes(s.value)}
              on:change={() => { signalTypes = toggleSignal(signalTypes, s.value); }} />
            {s.icon} {s.label}
          </label>
        {/each}
      </div>
    </div>
    <div class="scanner-form-field">
      <label class="scanner-form-label">Notifications</label>
      <select class="tracking-select" bind:value={notificationMode}>
        {#each NOTIFICATION_MODE_OPTIONS as o}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
    </div>
    <div class="scanner-form-field">
      <label class="scanner-form-label">Max items/scan</label>
      <input class="tracking-input scanner-input-narrow" type="number" min="1" max="25" bind:value={maxItemsPerScan} />
    </div>
  </div>

  <div class="scanner-form-row scanner-form-options">
    <div class="scanner-form-field">
      <label class="scanner-form-label">Dedup strategy</label>
      <select class="tracking-select" bind:value={dedupStrategy}>
        {#each DEDUP_STRATEGY_OPTIONS as o}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
    </div>
    <div class="scanner-form-field">
      <label class="scanner-form-label">Missed runs</label>
      <select class="tracking-select" bind:value={missedRunPolicy}>
        {#each MISSED_RUN_POLICY_OPTIONS as o}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
    </div>
    <div class="scanner-form-field">
      <label class="scanner-form-label">Group</label>
      <input class="tracking-input" type="text" placeholder="e.g., Work" bind:value={scannerGroupId} />
    </div>
  </div>

  <div class="scanner-form-row scanner-form-toggles">
    <label class="scanner-toggle-label"><input type="checkbox" bind:checked={autoMonitorNewItems} /> Auto-monitor new items</label>
    <label class="scanner-toggle-label"><input type="checkbox" bind:checked={workHoursOnly} /> Work hours only</label>
    <label class="scanner-toggle-label"><input type="checkbox" bind:checked={crossScannerDedup} /> Cross-scanner dedup</label>
    <label class="scanner-toggle-label"><input type="checkbox" bind:checked={runOnStartup} /> Run on startup</label>
  </div>

  <div class="scanner-form-section-label">Monitoring Defaults</div>
  <div class="scanner-form-row scanner-form-options">
    <div class="scanner-form-field">
      <label class="scanner-form-label">Auto-monitor threshold</label>
      <select class="tracking-select" bind:value={autoMonitorSeverityThreshold}>
        {#each SEVERITY_THRESHOLD_OPTIONS as o}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
    </div>
    <div class="scanner-form-field">
      <label class="scanner-form-label">Schedule type</label>
      <select class="tracking-select" bind:value={defaultMonitorScheduleType}>
        <option value="interval">Interval</option>
        <option value="weekly">Scheduled</option>
        <option value="one-time">One-time</option>
      </select>
    </div>
    {#if defaultMonitorScheduleType === 'interval'}
      <div class="scanner-form-field">
        <label class="scanner-form-label">Interval</label>
        <select class="tracking-select" bind:value={defaultMonitorSchedule}>
          {#each SCHEDULE_INTERVAL_OPTIONS as o}
            <option value={o.value}>Every {o.label}</option>
          {/each}
        </select>
      </div>
    {/if}
  </div>

  {#if defaultMonitorScheduleType === 'weekly'}
    <div class="scanner-form-row">
      <div class="scanner-form-field scanner-form-field-grow">
        <label class="scanner-form-label">Monitor days &amp; times</label>
        <div class="weekly-days-row">
          {#each WEEKLY_DAY_OPTIONS as d}
            <label class="weekly-day-label" class:active={defaultMonitorWeeklyDays.includes(d.value)}>
              <input type="checkbox" class="weekly-day-cb" value={d.value}
                checked={defaultMonitorWeeklyDays.includes(d.value)}
                on:change={(e) => {
                  defaultMonitorWeeklyDays = e.target.checked
                    ? [...defaultMonitorWeeklyDays, d.value]
                    : defaultMonitorWeeklyDays.filter(v => v !== d.value);
                  if (!defaultMonitorWeeklyDays.length) defaultMonitorWeeklyDays = [d.value];
                }} />
              {d.label}
            </label>
          {/each}
        </div>
        <div class="weekly-times-row">
          <label class="scanner-form-label">Times</label>
          <div class="weekly-time-slots">
            {#each defaultMonitorWeeklyTimes as t, i}
              <div class="weekly-time-slot">
                <input type="time" class="tracking-input weekly-time-picker" value={t}
                  on:change={(e) => { defaultMonitorWeeklyTimes = defaultMonitorWeeklyTimes.map((v, idx) => idx === i ? e.target.value : v); }} />
                {#if defaultMonitorWeeklyTimes.length > 1}
                  <button type="button" class="weekly-time-remove" title="Remove"
                    on:click={() => { defaultMonitorWeeklyTimes = defaultMonitorWeeklyTimes.filter((_, idx) => idx !== i); }}>&times;</button>
                {/if}
              </div>
            {/each}
          </div>
          <button type="button" class="small-btn weekly-time-add"
            on:click={() => { defaultMonitorWeeklyTimes = [...defaultMonitorWeeklyTimes, '09:00']; }}>+ Add</button>
        </div>
      </div>
    </div>
  {/if}

  <div class="scanner-form-row scanner-form-options">
    <div class="scanner-form-field">
      <label class="scanner-form-label">Monitor signals</label>
      <div class="scanner-signal-types">
        {#each SIGNAL_TYPE_OPTIONS as s}
          <label class="scanner-signal-label" class:active={defaultMonitorSignals.includes(s.value)}>
            <input type="checkbox" class="scanner-signal-cb" value={s.value}
              checked={defaultMonitorSignals.includes(s.value)}
              on:change={() => { defaultMonitorSignals = toggleSignal(defaultMonitorSignals, s.value); }} />
            {s.icon} {s.label}
          </label>
        {/each}
      </div>
    </div>
  </div>

  <div class="scanner-form-row scanner-form-toggles">
    <label class="scanner-toggle-label"><input type="checkbox" bind:checked={defaultMonitorWorkHoursOnly} /> Work hours only</label>
    <label class="scanner-toggle-label"><input type="checkbox" bind:checked={defaultMonitorNotifyEnabled} /> Notify on changes</label>
  </div>

  <div class="scanner-form-section-label">Lifecycle</div>
  <div class="scanner-form-row scanner-form-options">
    <div class="scanner-form-field">
      <label class="scanner-form-label">Auto-archive after (days)</label>
      <input class="tracking-input scanner-input-narrow" type="number" min="0" max="365" bind:value={autoArchiveAfterDays} title="0 = disabled" />
    </div>
    <div class="scanner-form-field">
      <label class="scanner-form-label">Retention (days)</label>
      <input class="tracking-input scanner-input-narrow" type="number" min="1" max="365" bind:value={retentionDays} />
    </div>
    <div class="scanner-form-field scanner-form-field-grow">
      <label class="scanner-form-label">Exclude keywords</label>
      <input class="tracking-input" type="text" placeholder="newsletter, digest, all-hands" bind:value={excludeKeywords} />
    </div>
  </div>
  <div class="scanner-form-row scanner-form-options">
    <div class="scanner-form-field scanner-form-field-grow">
      <label class="scanner-form-label">Webhook URL</label>
      <input class="tracking-input" type="url" placeholder="https://hooks.slack.com/..." bind:value={webhookUrl} />
    </div>
  </div>

  <div class="scanner-form-actions">
    <button class="small-btn primary" on:click={() => dispatch('save', collectValues())}>
      {isEdit ? 'Update Scanner' : 'Create Scanner'}
    </button>
    {#if isEdit}
      <button class="small-btn" on:click={() => dispatch('runnow')}>Run Now</button>
    {/if}
    <button class="small-btn" on:click={() => dispatch('cancel')}>Cancel</button>
  </div>
</div>
