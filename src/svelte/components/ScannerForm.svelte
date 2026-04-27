<script>
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

  let { scanner = null, onsave, onrunnow, oncancel } = $props();

  let isEdit = $derived(scanner != null);

  let name = $state(isEdit ? (scanner.name || '') : '');
  let prompt = $state(isEdit ? (scanner.prompt || '') : '');
  let scheduleType = $state((isEdit && scanner.scheduleType) || 'interval');
  let scheduleValue = $state((isEdit && scanner.scheduleValue) || '30m');
  let workHoursOnly = $state(isEdit ? scanner.workHoursOnly === true : false);
  let autoMonitorNewItems = $state(isEdit ? scanner.autoMonitorNewItems === true : false);
  let notificationMode = $state((isEdit && scanner.notificationMode) || 'all');
  let signalTypes = $state(isEdit && Array.isArray(scanner.signalTypes) ? [...scanner.signalTypes] : [...ALL_SIGNAL_TYPES]);
  let crossScannerDedup = $state(isEdit ? scanner.crossScannerDedup !== false : true);
  let autoMonitorSeverityThreshold = $state((isEdit && scanner.autoMonitorSeverityThreshold) || 'all');
  let maxItemsPerScan = $state(isEdit ? (scanner.maxItemsPerScan || 10) : 10);
  let missedRunPolicy = $state((isEdit && scanner.missedRunPolicy) || 'run-once');
  let dedupStrategy = $state((isEdit && scanner.dedupStrategy) || 'evidence-url');
  let excludeKeywords = $state(isEdit && Array.isArray(scanner.excludeKeywords) ? scanner.excludeKeywords.join(', ') : '');
  let defaultMonitorSchedule = $state((isEdit && scanner.defaultMonitorSchedule) || '30m');
  let defaultMonitorScheduleType = $state((isEdit && scanner.defaultMonitorScheduleType) || 'interval');
  let defaultMonitorWorkHoursOnly = $state(isEdit ? scanner.defaultMonitorWorkHoursOnly === true : false);
  let defaultMonitorNotifyEnabled = $state(isEdit ? scanner.defaultMonitorNotifyEnabled !== false : true);
  let defaultMonitorSignals = $state(isEdit && Array.isArray(scanner.defaultMonitorSignals) ? [...scanner.defaultMonitorSignals] : [...ALL_SIGNAL_TYPES]);
  let autoArchiveAfterDays = $state(isEdit ? (scanner.autoArchiveAfterDays || 0) : 0);
  let retentionDays = $state(isEdit ? (scanner.retentionDays || 365) : 365);
  let scannerGroupId = $state(isEdit ? (scanner.scannerGroupId || '') : '');

  let weeklyDays = $state(isEdit && Array.isArray(scanner.weeklyDays) ? [...scanner.weeklyDays] : [...DEFAULT_WEEKLY_DAYS]);
  let weeklyTimes = $state(isEdit && Array.isArray(scanner.weeklyTimes) ? [...scanner.weeklyTimes] : [...DEFAULT_WEEKLY_TIMES]);
  let defaultMonitorWeeklyDays = $state(isEdit && Array.isArray(scanner.defaultMonitorWeeklyDays) ? [...scanner.defaultMonitorWeeklyDays] : [...DEFAULT_WEEKLY_DAYS]);
  let defaultMonitorWeeklyTimes = $state(isEdit && Array.isArray(scanner.defaultMonitorWeeklyTimes) ? [...scanner.defaultMonitorWeeklyTimes] : [...DEFAULT_WEEKLY_TIMES]);

  let optionsOpen = $state(!isEdit);
  let monitoringDefaultsOpen = $state(!isEdit);
  let lifecycleOpen = $state(!isEdit);

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
      <label class="scanner-form-label" title="A short name to identify this scanner in the sidebar">Name</label>
      <input class="tracking-input" type="text" placeholder="e.g., Competitor Intel" bind:value={name} />
    </div>
    <div class="scanner-form-field">
      <label class="scanner-form-label" title="How often this scanner runs: on a fixed interval, specific days/times, or just once">Schedule</label>
      <select class="tracking-select" bind:value={scheduleType}>
        <option value="interval">Interval</option>
        <option value="weekly">Scheduled</option>
        <option value="one-time">One-time</option>
      </select>
    </div>
    {#if scheduleType === 'interval'}
      <div class="scanner-form-field">
        <label class="scanner-form-label" title="How frequently the scanner repeats (e.g., every 30 minutes or every 4 hours)">Interval</label>
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
        <label class="scanner-form-label" title="Which days of the week and times of day this scanner should run">Days &amp; Times</label>
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
      <label class="scanner-form-label" title="Instructions telling the AI what signals to look for. Be specific about what matters to you.">Prompt</label>
      <textarea class="tracking-textarea" placeholder="What should this scanner look for?" bind:value={prompt}></textarea>
    </div>
  </div>

  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="scanner-form-section-label collapsible" on:click={() => optionsOpen = !optionsOpen}>
    <span class="section-chevron">{optionsOpen ? '▾' : '▸'}</span> Options
  </div>
  {#if optionsOpen}
  <div class="scanner-form-row scanner-form-options">
    <div class="scanner-form-field">
      <label class="scanner-form-label" title="Which Microsoft 365 signal types to scan: email, chat, meetings, or documents">Signal Types</label>
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
      <label class="scanner-form-label" title="When to show desktop notifications for new scanner results">Notifications</label>
      <select class="tracking-select" bind:value={notificationMode}>
        {#each NOTIFICATION_MODE_OPTIONS as o}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
    </div>
    <div class="scanner-form-field">
      <label class="scanner-form-label" title="Maximum number of items returned per scan run (1–25)">Max items/scan</label>
      <input class="tracking-input scanner-input-narrow" type="number" min="1" max="25" bind:value={maxItemsPerScan} />
    </div>
  </div>

  <div class="scanner-form-row scanner-form-options">
    <div class="scanner-form-field">
      <label class="scanner-form-label" title="How to detect duplicate items: by matching evidence URLs, similar titles, or both">Dedup strategy</label>
      <select class="tracking-select" bind:value={dedupStrategy}>
        {#each DEDUP_STRATEGY_OPTIONS as o}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
    </div>
    <div class="scanner-form-field">
      <label class="scanner-form-label" title="What to do when the app was closed during a scheduled scan: skip it, run once on reopen, or catch up (max 3)">Missed runs</label>
      <select class="tracking-select" bind:value={missedRunPolicy}>
        {#each MISSED_RUN_POLICY_OPTIONS as o}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
    </div>
  </div>

  <div class="scanner-form-row scanner-form-toggles">
    <label class="scanner-toggle-label" title="Automatically start monitoring newly discovered items so you get ongoing updates"><input type="checkbox" bind:checked={autoMonitorNewItems} /> Auto-monitor new items</label>
    <label class="scanner-toggle-label" title="Only run this scanner during business hours (Mon–Fri, 8am–6pm local time)"><input type="checkbox" bind:checked={workHoursOnly} /> Work hours only</label>
    <label class="scanner-toggle-label" title="Prevent the same item from appearing in multiple scanners by checking across all scanner results"><input type="checkbox" bind:checked={crossScannerDedup} /> Cross-scanner dedup</label>
  </div>
  {/if}

  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="scanner-form-section-label collapsible" on:click={() => monitoringDefaultsOpen = !monitoringDefaultsOpen}>
    <span class="section-chevron">{monitoringDefaultsOpen ? '▾' : '▸'}</span> Monitoring Defaults
  </div>
  {#if monitoringDefaultsOpen}
  <div class="scanner-form-row scanner-form-options">
    <div class="scanner-form-field">
      <label class="scanner-form-label" title="Minimum severity required for auto-monitoring: monitor everything, only Critical, or Elevated and above">Auto-monitor threshold</label>
      <select class="tracking-select" bind:value={autoMonitorSeverityThreshold}>
        {#each SEVERITY_THRESHOLD_OPTIONS as o}
          <option value={o.value}>{o.label}</option>
        {/each}
      </select>
    </div>
    <div class="scanner-form-field">
      <label class="scanner-form-label" title="Default schedule type for monitoring newly discovered items">Schedule type</label>
      <select class="tracking-select" bind:value={defaultMonitorScheduleType}>
        <option value="interval">Interval</option>
        <option value="weekly">Scheduled</option>
        <option value="one-time">One-time</option>
      </select>
    </div>
    {#if defaultMonitorScheduleType === 'interval'}
      <div class="scanner-form-field">
        <label class="scanner-form-label" title="Default monitoring interval for newly tracked items">Interval</label>
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
        <label class="scanner-form-label" title="Default days and times for monitoring newly tracked items">Monitor days &amp; times</label>
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
      <label class="scanner-form-label" title="Which signal types to check when monitoring items from this scanner">Monitor signals</label>
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
    <label class="scanner-toggle-label" title="Only run monitoring checks during business hours for items from this scanner"><input type="checkbox" bind:checked={defaultMonitorWorkHoursOnly} /> Work hours only</label>
    <label class="scanner-toggle-label" title="Show desktop notifications when monitored items have meaningful changes"><input type="checkbox" bind:checked={defaultMonitorNotifyEnabled} /> Notify on changes</label>
  </div>
  {/if}

  <!-- svelte-ignore a11y-click-events-have-key-events -->
  <!-- svelte-ignore a11y-no-static-element-interactions -->
  <div class="scanner-form-section-label collapsible" on:click={() => lifecycleOpen = !lifecycleOpen}>
    <span class="section-chevron">{lifecycleOpen ? '▾' : '▸'}</span> Lifecycle
  </div>
  {#if lifecycleOpen}
  <div class="scanner-form-row scanner-form-options">
    <div class="scanner-form-field">
      <label class="scanner-form-label" title="Automatically archive items after this many days with no new activity (0 = disabled)">Auto-archive after (days)</label>
      <input class="tracking-input scanner-input-narrow" type="number" min="0" max="365" bind:value={autoArchiveAfterDays} title="0 = disabled" />
    </div>
    <div class="scanner-form-field">
      <label class="scanner-form-label" title="How long to keep completed/archived items before permanently removing them">Retention (days)</label>
      <input class="tracking-input scanner-input-narrow" type="number" min="1" max="365" bind:value={retentionDays} />
    </div>
    <div class="scanner-form-field scanner-form-field-grow">
      <label class="scanner-form-label" title="Comma-separated words — items containing any of these in the title or summary will be filtered out">Exclude keywords</label>
      <input class="tracking-input" type="text" placeholder="newsletter, digest, all-hands" bind:value={excludeKeywords} />
    </div>
  </div>
  {/if}

  <div class="scanner-form-actions">
    <button class="small-btn primary" on:click={() => onsave?.(collectValues())}>
      {isEdit ? 'Update Scanner' : 'Create Scanner'}
    </button>
    {#if isEdit}
      <button class="small-btn" on:click={() => onrunnow?.()}>Run Now</button>
    {/if}
    <button class="small-btn" on:click={() => oncancel?.()}>Cancel</button>
  </div>
</div>
