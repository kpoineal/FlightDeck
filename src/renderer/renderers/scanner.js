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
      <div class="scanner-form-actions">
        <button class="small-btn primary" data-scanner-save="${scannerId}">${isEdit ? 'Update Scanner' : 'Create Scanner'}</button>
        <button class="small-btn" data-scanner-cancel>Cancel</button>
      </div>
    </div>
  `;
}
