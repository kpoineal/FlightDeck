// ── Scanner management UI ───────────────────────────────────────────

function buildScannerBadge() {
  return '';
}

function buildScannerForm(scanner) {
  const isEdit = scanner != null;
  const name = isEdit ? escapeHtml(scanner.name || '') : '';
  const prompt = isEdit ? escapeHtml(scanner.prompt || '') : '';
  const scheduleType = (isEdit && scanner.scheduleType) || 'interval';
  const scheduleValue = (isEdit && scanner.scheduleValue) || '30m';
  const scannerId = isEdit ? escapeHtml(String(scanner.id)) : '';

  const weeklyDays = isEdit && Array.isArray(scanner.weeklyDays) ? scanner.weeklyDays : DEFAULT_WEEKLY_DAYS;
  const weeklyTimes = isEdit && Array.isArray(scanner.weeklyTimes) ? scanner.weeklyTimes : DEFAULT_WEEKLY_TIMES;

  const workHoursOnly = isEdit ? scanner.workHoursOnly === true : false;
  const autoMonitorNewItems = isEdit ? scanner.autoMonitorNewItems === true : false;
  const notificationMode = (isEdit && scanner.notificationMode) || 'all';
  const signalTypes = isEdit && Array.isArray(scanner.signalTypes) ? scanner.signalTypes : ALL_SIGNAL_TYPES;
  const crossScannerDedup = isEdit ? scanner.crossScannerDedup !== false : true;
  const autoMonitorSeverityThreshold = (isEdit && scanner.autoMonitorSeverityThreshold) || 'all';
  const maxItemsPerScan = isEdit ? (scanner.maxItemsPerScan || 10) : 10;
  const runOnStartup = isEdit ? scanner.runOnStartup === true : false;
  const missedRunPolicy = (isEdit && scanner.missedRunPolicy) || 'run-once';
  const dedupStrategy = (isEdit && scanner.dedupStrategy) || 'evidence-url';
  const excludeKeywords = isEdit && Array.isArray(scanner.excludeKeywords) ? scanner.excludeKeywords.join(', ') : '';
  const defaultMonitorSchedule = (isEdit && scanner.defaultMonitorSchedule) || '30m';
  const defaultMonitorScheduleType = (isEdit && scanner.defaultMonitorScheduleType) || 'interval';
  const defaultMonitorWorkHoursOnly = isEdit ? scanner.defaultMonitorWorkHoursOnly === true : false;
  const defaultMonitorSignals = isEdit && Array.isArray(scanner.defaultMonitorSignals) ? scanner.defaultMonitorSignals : ALL_SIGNAL_TYPES;
  const defaultMonitorNotifyEnabled = isEdit ? scanner.defaultMonitorNotifyEnabled !== false : true;
  const defaultMonitorWeeklyDays = isEdit && Array.isArray(scanner.defaultMonitorWeeklyDays) ? scanner.defaultMonitorWeeklyDays : DEFAULT_WEEKLY_DAYS;
  const defaultMonitorWeeklyTimes = isEdit && Array.isArray(scanner.defaultMonitorWeeklyTimes) ? scanner.defaultMonitorWeeklyTimes : DEFAULT_WEEKLY_TIMES;
  const autoArchiveAfterDays = isEdit ? (scanner.autoArchiveAfterDays || 0) : 0;
  const retentionDays = isEdit ? (scanner.retentionDays || 365) : 365;
  const webhookUrl = isEdit ? escapeHtml(scanner.webhookUrl || '') : '';
  const scannerGroupId = isEdit ? escapeHtml(scanner.scannerGroupId || '') : '';

  return `
    <div class="scanner-form" data-scanner-form-id="${scannerId}">
      <div class="scanner-form-row">
        <div class="scanner-form-field scanner-form-field-grow">
          <label class="scanner-form-label" for="scannerFormName">Name</label>
          <input id="scannerFormName" class="tracking-input" type="text" placeholder="e.g., Competitor Intel" value="${name}" data-scanner-input="name" />
        </div>
        <div class="scanner-form-field">
          <label class="scanner-form-label" for="scannerFormScheduleType">Schedule</label>
          <select id="scannerFormScheduleType" class="tracking-select" data-scanner-input="scheduleType">
            <option value="interval" ${scheduleType === 'interval' ? 'selected' : ''}>Interval</option>
            <option value="weekly" ${scheduleType === 'weekly' ? 'selected' : ''}>Scheduled</option>
            <option value="one-time" ${scheduleType === 'one-time' ? 'selected' : ''}>One-time</option>
          </select>
        </div>
        <div class="scanner-form-field${scheduleType === 'interval' ? '' : ' d-none'}" data-scanner-interval-field>
          <label class="scanner-form-label" for="scannerFormScheduleValue">Interval</label>
          <select id="scannerFormScheduleValue" class="tracking-select" data-scanner-input="scheduleValue">
            <option value="15m" ${scheduleValue === '15m' ? 'selected' : ''}>Every 15m</option>
            <option value="30m" ${scheduleValue === '30m' ? 'selected' : ''}>Every 30m</option>
            <option value="1h" ${scheduleValue === '1h' ? 'selected' : ''}>Every 1h</option>
            <option value="2h" ${scheduleValue === '2h' ? 'selected' : ''}>Every 2h</option>
            <option value="4h" ${scheduleValue === '4h' ? 'selected' : ''}>Every 4h</option>
          </select>
        </div>
      </div>
      <div class="scanner-form-row${scheduleType === 'weekly' ? '' : ' d-none'}" data-scanner-weekly-panel>
        <div class="scanner-form-field scanner-form-field-grow">
          <label class="scanner-form-label">Days &amp; Times</label>
          <div class="weekly-days-row">
            ${WEEKLY_DAY_OPTIONS.map((d) => `
              <label class="weekly-day-label ${weeklyDays.includes(d.value) ? 'active' : ''}">
                <input type="checkbox" class="weekly-day-cb" data-scanner-weekly-day value="${escapeHtml(d.value)}" ${weeklyDays.includes(d.value) ? 'checked' : ''} />
                ${escapeHtml(d.label)}
              </label>
            `).join('')}
          </div>
          <div class="weekly-times-row">
            <label class="scanner-form-label">Times</label>
            <div class="weekly-time-slots" data-scanner-time-slots>
              ${weeklyTimes.map((t, i) => `
                <div class="weekly-time-slot">
                  <input type="time" class="tracking-input weekly-time-picker" data-scanner-weekly-time value="${escapeHtml(t)}" />
                  ${weeklyTimes.length > 1 ? '<button type="button" class="weekly-time-remove" data-scanner-remove-time title="Remove">&times;</button>' : ''}
                </div>
              `).join('')}
            </div>
            <button type="button" class="small-btn weekly-time-add" data-scanner-add-time>+ Add</button>
          </div>
        </div>
      </div>
      <div class="scanner-form-row">
        <div class="scanner-form-field scanner-form-field-grow">
          <label class="scanner-form-label" for="scannerFormPrompt">Prompt</label>
          <textarea id="scannerFormPrompt" class="tracking-textarea" placeholder="What should this scanner look for? Use {lastRunAt} for time-based filtering." data-scanner-input="prompt">${prompt}</textarea>
        </div>
      </div>
      <div class="scanner-form-section-label">Options</div>
      <div class="scanner-form-row scanner-form-options">
        <div class="scanner-form-field">
          <label class="scanner-form-label">Signal Types</label>
          <div class="scanner-signal-types">
            ${SIGNAL_TYPE_OPTIONS.map((s) => `
              <label class="scanner-signal-label ${signalTypes.includes(s.value) ? 'active' : ''}">
                <input type="checkbox" class="scanner-signal-cb" data-scanner-signal-type value="${escapeHtml(s.value)}" ${signalTypes.includes(s.value) ? 'checked' : ''} />
                ${s.icon} ${escapeHtml(s.label)}
              </label>
            `).join('')}
          </div>
        </div>
        <div class="scanner-form-field">
          <label class="scanner-form-label" for="scannerFormNotificationMode">Notifications</label>
          <select id="scannerFormNotificationMode" class="tracking-select" data-scanner-input="notificationMode">
            ${NOTIFICATION_MODE_OPTIONS.map((o) => `<option value="${escapeHtml(o.value)}" ${notificationMode === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </div>
        <div class="scanner-form-field">
          <label class="scanner-form-label" for="scannerFormMaxItems">Max items/scan</label>
          <input id="scannerFormMaxItems" class="tracking-input scanner-input-narrow" type="number" min="1" max="25" value="${maxItemsPerScan}" data-scanner-input="maxItemsPerScan" />
        </div>
      </div>
      <div class="scanner-form-row scanner-form-options">
        <div class="scanner-form-field">
          <label class="scanner-form-label" for="scannerFormDedupStrategy">Dedup strategy</label>
          <select id="scannerFormDedupStrategy" class="tracking-select" data-scanner-input="dedupStrategy">
            ${DEDUP_STRATEGY_OPTIONS.map((o) => `<option value="${escapeHtml(o.value)}" ${dedupStrategy === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </div>
        <div class="scanner-form-field">
          <label class="scanner-form-label" for="scannerFormMissedRun">Missed runs</label>
          <select id="scannerFormMissedRun" class="tracking-select" data-scanner-input="missedRunPolicy">
            ${MISSED_RUN_POLICY_OPTIONS.map((o) => `<option value="${escapeHtml(o.value)}" ${missedRunPolicy === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </div>
        <div class="scanner-form-field">
          <label class="scanner-form-label" for="scannerFormGroup">Group</label>
          <input id="scannerFormGroup" class="tracking-input" type="text" placeholder="e.g., Work" value="${scannerGroupId}" data-scanner-input="scannerGroupId" />
        </div>
      </div>
      <div class="scanner-form-row scanner-form-toggles">
        <label class="scanner-toggle-label">
          <input type="checkbox" data-scanner-input="autoMonitorNewItems" ${autoMonitorNewItems ? 'checked' : ''} />
          Auto-monitor new items
        </label>
        <label class="scanner-toggle-label">
          <input type="checkbox" data-scanner-input="workHoursOnly" ${workHoursOnly ? 'checked' : ''} />
          Work hours only
        </label>
        <label class="scanner-toggle-label">
          <input type="checkbox" data-scanner-input="crossScannerDedup" ${crossScannerDedup ? 'checked' : ''} />
          Cross-scanner dedup
        </label>
        <label class="scanner-toggle-label">
          <input type="checkbox" data-scanner-input="runOnStartup" ${runOnStartup ? 'checked' : ''} />
          Run on startup
        </label>
      </div>
      <div class="scanner-form-section-label">Monitoring Defaults</div>
      <div class="scanner-form-row scanner-form-options">
        <div class="scanner-form-field">
          <label class="scanner-form-label" for="scannerFormAutoMonitorThreshold">Auto-monitor threshold</label>
          <select id="scannerFormAutoMonitorThreshold" class="tracking-select" data-scanner-input="autoMonitorSeverityThreshold">
            ${SEVERITY_THRESHOLD_OPTIONS.map((o) => `<option value="${escapeHtml(o.value)}" ${autoMonitorSeverityThreshold === o.value ? 'selected' : ''}>${escapeHtml(o.label)}</option>`).join('')}
          </select>
        </div>
        <div class="scanner-form-field">
          <label class="scanner-form-label" for="scannerFormDefaultMonitorScheduleType">Schedule type</label>
          <select id="scannerFormDefaultMonitorScheduleType" class="tracking-select" data-scanner-input="defaultMonitorScheduleType">
            <option value="interval" ${defaultMonitorScheduleType === 'interval' ? 'selected' : ''}>Interval</option>
            <option value="weekly" ${defaultMonitorScheduleType === 'weekly' ? 'selected' : ''}>Scheduled</option>
            <option value="one-time" ${defaultMonitorScheduleType === 'one-time' ? 'selected' : ''}>One-time</option>
          </select>
        </div>
        <div class="scanner-form-field${defaultMonitorScheduleType === 'interval' ? '' : ' d-none'}" data-monitor-interval-field>
          <label class="scanner-form-label" for="scannerFormDefaultMonitorSchedule">Interval</label>
          <select id="scannerFormDefaultMonitorSchedule" class="tracking-select" data-scanner-input="defaultMonitorSchedule">
            ${SCHEDULE_INTERVAL_OPTIONS.map((o) => `<option value="${escapeHtml(o.value)}" ${defaultMonitorSchedule === o.value ? 'selected' : ''}>${escapeHtml('Every ' + o.label)}</option>`).join('')}
          </select>
        </div>
      </div>
      <div class="scanner-form-row${defaultMonitorScheduleType === 'weekly' ? '' : ' d-none'}" data-monitor-weekly-panel>
        <div class="scanner-form-field scanner-form-field-grow">
          <label class="scanner-form-label">Monitor days &amp; times</label>
          <div class="weekly-days-row">
            ${WEEKLY_DAY_OPTIONS.map((d) => `
              <label class="weekly-day-label ${defaultMonitorWeeklyDays.includes(d.value) ? 'active' : ''}">
                <input type="checkbox" class="weekly-day-cb" data-scanner-monitor-weekly-day value="${escapeHtml(d.value)}" ${defaultMonitorWeeklyDays.includes(d.value) ? 'checked' : ''} />
                ${escapeHtml(d.label)}
              </label>
            `).join('')}
          </div>
          <div class="weekly-times-row">
            <label class="scanner-form-label">Times</label>
            <div class="weekly-time-slots" data-scanner-monitor-time-slots>
              ${defaultMonitorWeeklyTimes.map((t) => `
                <div class="weekly-time-slot">
                  <input type="time" class="tracking-input weekly-time-picker" data-scanner-monitor-weekly-time value="${escapeHtml(t)}" />
                  ${defaultMonitorWeeklyTimes.length > 1 ? '<button type="button" class="weekly-time-remove" data-scanner-monitor-remove-time title="Remove">&times;</button>' : ''}
                </div>
              `).join('')}
            </div>
            <button type="button" class="small-btn weekly-time-add" data-scanner-monitor-add-time>+ Add</button>
          </div>
        </div>
      </div>
      <div class="scanner-form-row scanner-form-options">
        <div class="scanner-form-field">
          <label class="scanner-form-label">Monitor signals</label>
          <div class="scanner-signal-types">
            ${SIGNAL_TYPE_OPTIONS.map((s) => `
              <label class="scanner-signal-label ${defaultMonitorSignals.includes(s.value) ? 'active' : ''}">
                <input type="checkbox" class="scanner-signal-cb" data-scanner-monitor-signal-type value="${escapeHtml(s.value)}" ${defaultMonitorSignals.includes(s.value) ? 'checked' : ''} />
                ${s.icon} ${escapeHtml(s.label)}
              </label>
            `).join('')}
          </div>
        </div>
      </div>
      <div class="scanner-form-row scanner-form-toggles">
        <label class="scanner-toggle-label">
          <input type="checkbox" data-scanner-input="defaultMonitorWorkHoursOnly" ${defaultMonitorWorkHoursOnly ? 'checked' : ''} />
          Work hours only
        </label>
        <label class="scanner-toggle-label">
          <input type="checkbox" data-scanner-input="defaultMonitorNotifyEnabled" ${defaultMonitorNotifyEnabled ? 'checked' : ''} />
          Notify on changes
        </label>
      </div>
      <div class="scanner-form-section-label">Lifecycle</div>
      <div class="scanner-form-row scanner-form-options">
        <div class="scanner-form-field">
          <label class="scanner-form-label" for="scannerFormAutoArchive">Auto-archive after (days)</label>
          <input id="scannerFormAutoArchive" class="tracking-input scanner-input-narrow" type="number" min="0" max="365" value="${autoArchiveAfterDays}" data-scanner-input="autoArchiveAfterDays" title="0 = disabled" />
        </div>
        <div class="scanner-form-field">
          <label class="scanner-form-label" for="scannerFormRetention">Retention (days)</label>
          <input id="scannerFormRetention" class="tracking-input scanner-input-narrow" type="number" min="1" max="365" value="${retentionDays}" data-scanner-input="retentionDays" />
        </div>
        <div class="scanner-form-field scanner-form-field-grow">
          <label class="scanner-form-label" for="scannerFormExcludeKeywords">Exclude keywords</label>
          <input id="scannerFormExcludeKeywords" class="tracking-input" type="text" placeholder="newsletter, digest, all-hands" value="${escapeHtml(excludeKeywords)}" data-scanner-input="excludeKeywords" />
        </div>
      </div>
      <div class="scanner-form-row scanner-form-options">
        <div class="scanner-form-field scanner-form-field-grow">
          <label class="scanner-form-label" for="scannerFormWebhookUrl">Webhook URL</label>
          <input id="scannerFormWebhookUrl" class="tracking-input" type="url" placeholder="https://hooks.slack.com/..." value="${webhookUrl}" data-scanner-input="webhookUrl" />
        </div>
      </div>
      <div class="scanner-form-actions">
        <button class="small-btn primary" data-scanner-save="${scannerId}">${isEdit ? 'Update Scanner' : 'Create Scanner'}</button>
        <button class="small-btn" data-scanner-cancel>Cancel</button>
      </div>
    </div>
  `;
}
