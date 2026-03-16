// ── Briefing rendering — briefing pane, ledger cards ─────────────────

function buildFallbackMeetingPayload() {
  const now = new Date();
  const meetingStart = new Date(now.getTime() + 60 * 60 * 1000);
  const meetingEnd = new Date(now.getTime() + 90 * 60 * 1000);
  return {
    generatedAt: nowIso(),
    meetings: [
      {
        id: 'fallback_meeting_1',
        title: 'Priority Sync',
        startAt: meetingStart.toISOString(),
        endAt: meetingEnd.toISOString(),
        organizer: 'Unknown organizer',
        joinUrl: null,
      },
    ],
  };
}

function renderDayBriefingCard() {
  const dayBriefing = getDayBriefing();
  const hasDayBriefing = !!dayBriefing;
  const unseen = isBriefingUnseen(DAY_BRIEFING_KEY, dayBriefing);

  if (!hasDayBriefing) {
    return `
      <details class="list-card day-briefing-card" open>
        <summary>
          <span class="pill unbriefed">My Day</span>
          <span class="list-title">☀️ My Day Briefing</span>
        </summary>
        <div class="card-body">
          <div class="empty">No day briefing generated yet. Synthesize your meetings, tracked items, and radar signals into one summary.</div>
          <div class="action-row">
            <button class="small-btn primary" data-generate-day-briefing>Generate My Day</button>
          </div>
        </div>
      </details>
    `;
  }

  const priorities = dayBriefing.topPriorities?.length
    ? dayBriefing.topPriorities.map((line) => `<li>${escapeHtml(sanitizeBriefingText(line))}</li>`).join('')
    : '<li>No priorities listed.</li>';

  const prepMeetings = dayBriefing.meetingsRequiringPrep?.length
    ? dayBriefing.meetingsRequiringPrep.map((m) => `<li><strong>${escapeHtml(sanitizeBriefingText(m.title))}</strong>${m.startAt ? ` at ${escapeHtml(safeDate(m.startAt, 'TBD'))}` : ''} &mdash; ${escapeHtml(sanitizeBriefingText(m.whyPrepNeeded))}</li>`).join('')
    : '<li>No meetings require special prep.</li>';

  const riskItems = dayBriefing.atRiskItems?.length
    ? dayBriefing.atRiskItems.map((item) => `<li><span class="pill ${escapeHtml(item.severity?.toLowerCase() || 'observe')}">${escapeHtml(item.severity)}</span> <strong>${escapeHtml(sanitizeBriefingText(item.title))}</strong> &mdash; ${escapeHtml(sanitizeBriefingText(item.risk))}</li>`).join('')
    : '<li>No items at risk.</li>';

  const timeBlocks = dayBriefing.suggestedTimeBlocks?.length
    ? dayBriefing.suggestedTimeBlocks.map((block) => `<li><strong>${escapeHtml(sanitizeBriefingText(block.time))}</strong>: ${escapeHtml(sanitizeBriefingText(block.activity))} &mdash; ${escapeHtml(sanitizeBriefingText(block.rationale))}</li>`).join('')
    : '<li>No time blocks suggested.</li>';

  const followUps = dayBriefing.todayFollowUps?.length
    ? dayBriefing.todayFollowUps.map((line) => `<li>${escapeHtml(sanitizeBriefingText(line))}</li>`).join('')
    : '<li>No follow-up items.</li>';

  const sources = dayBriefing.sources?.length
    ? dayBriefing.sources.map((entry, index) => `<li><a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.label || `source ${index + 1}`)}</a></li>`).join('')
    : '<li>No sources listed.</li>';

  return `
    <details class="list-card day-briefing-card" data-briefing-meeting-id="${escapeHtml(DAY_BRIEFING_KEY)}" open>
      <summary>
        <span class="pill briefed">My Day</span>
        ${unseen ? '<span class="pill briefed">New</span>' : ''}
        <span class="list-title">☀️ My Day Briefing</span>
      </summary>
      <div class="card-body">
        <div class="action-row">
          <button class="small-btn primary" data-generate-day-briefing>Regenerate My Day</button>
        </div>
        <div class="evidence-box">
          <h3>${escapeHtml(dayBriefing.headline || 'Your day at a glance')}</h3>
          <div class="panel-sub">Generated: ${escapeHtml(safeDate(dayBriefing.generatedAt, 'Unknown'))}</div>
          <h4>Top Priorities</h4>
          <ul>${priorities}</ul>
          <h4>Meetings Requiring Prep</h4>
          <ul>${prepMeetings}</ul>
          <h4>At-Risk Items</h4>
          <ul>${riskItems}</ul>
          <h4>Suggested Time Blocks</h4>
          <ul>${timeBlocks}</ul>
          <h4>Follow-Ups</h4>
          <ul>${followUps}</ul>
          <h4>Sources</h4>
          <ul>${sources}</ul>
        </div>
      </div>
    </details>
  `;
}

function renderBriefingsMode() {
  const openMeetingIds = [...elements.briefingPane.querySelectorAll('details[data-briefing-meeting-id][open]')]
    .map((entry) => entry.getAttribute('data-briefing-meeting-id'))
    .filter(Boolean);
  if (openMeetingIds.length || state.expandedBriefingMeetingIds.length) {
    state.expandedBriefingMeetingIds = [...new Set(openMeetingIds.filter((meetingId) => meetingId === DAY_BRIEFING_KEY || state.meetings.some((meeting) => meeting.id === meetingId)))];
  }

  if (!state.meetings.length) {
    elements.briefingPane.className = '';
    elements.briefingPane.innerHTML = renderDayBriefingCard() + '<div class="empty">No upcoming meetings for today. Click Refresh to reload.</div>';
    state.expandedBriefingMeetingIds = [];
    renderKpis();
    return;
  }

  state.expandedBriefingMeetingIds = state.expandedBriefingMeetingIds
    .filter((meetingId) => meetingId === DAY_BRIEFING_KEY || state.meetings.some((meeting) => meeting.id === meetingId));

  elements.briefingPane.className = '';

  const statusRank = { unbriefed: 0, briefed: 1 };
  const sortedMeetings = [...state.meetings].sort((a, b) => {
    const briefingA = getBriefingForMeeting(a);
    const briefingB = getBriefingForMeeting(b);
    const unseenA = isBriefingUnseen(a.id, briefingA) ? 0 : 1;
    const unseenB = isBriefingUnseen(b.id, briefingB) ? 0 : 1;
    if (unseenA !== unseenB) return unseenA - unseenB;
    const rankA = statusRank[classifyBriefingSeverity(a, briefingA)] ?? 1;
    const rankB = statusRank[classifyBriefingSeverity(b, briefingB)] ?? 1;
    if (rankA !== rankB) return rankA - rankB;
    const timeA = a.startAt ? new Date(a.startAt).getTime() : Infinity;
    const timeB = b.startAt ? new Date(b.startAt).getTime() : Infinity;
    return timeA - timeB;
  });

  elements.briefingPane.innerHTML = renderDayBriefingCard() + sortedMeetings.map((meeting) => {
    const briefing = getBriefingForMeeting(meeting);
    const hasBriefing = !!briefing;
    const unseen = isBriefingUnseen(meeting.id, briefing);
    const briefingStatus = classifyBriefingSeverity(meeting, briefing);
    const severityClass = briefingStatus === 'briefed' ? 'briefed' : 'unbriefed';
    const isExpanded = state.expandedBriefingMeetingIds.includes(meeting.id);
    const meetingJoinLink = meeting.joinUrl
      ? `<a href="${escapeHtml(meeting.joinUrl)}" target="_blank" rel="noopener noreferrer">join meeting</a>`
      : 'No join link';

    const keyUpdates = briefing?.keyUpdates?.length
      ? briefing.keyUpdates.map((line) => `<li>${escapeHtml(sanitizeBriefingText(line))}</li>`).join('')
      : '<li>No key updates yet.</li>';
    const decisions = briefing?.decisionsNeeded?.length
      ? briefing.decisionsNeeded.map((line) => `<li>${escapeHtml(sanitizeBriefingText(line))}</li>`).join('')
      : '<li>No explicit decisions listed.</li>';
    const risks = briefing?.topRisks?.length
      ? briefing.topRisks.map((line) => `<li>${escapeHtml(sanitizeBriefingText(line))}</li>`).join('')
      : '<li>No risks listed.</li>';
    const talkTrack = briefing?.talkTrack?.length
      ? briefing.talkTrack.map((line) => `<li>${escapeHtml(sanitizeBriefingText(line))}</li>`).join('')
      : '<li>No talk track yet.</li>';

    const followUps = briefing
      ? (briefing.todayFollowUps?.length ? briefing.todayFollowUps : briefing.todayPlan)
      : [];
    const followUpMarkup = followUps.length
      ? followUps.map((line) => `<li>${escapeHtml(sanitizeBriefingText(line))}</li>`).join('')
      : '<li>No follow-up items.</li>';

    const sources = briefing?.sources?.length
      ? briefing.sources.map((entry, index) => `<li><a href="${escapeHtml(entry.url)}" target="_blank" rel="noopener noreferrer">${escapeHtml(entry.label || `source ${index + 1}`)}</a></li>`).join('')
      : '<li>No sources listed.</li>';

    return `
      <details class="list-card" data-briefing-meeting-id="${escapeHtml(meeting.id)}" ${isExpanded ? 'open' : ''}>
        <summary>
          <span class="pill ${severityClass}">${escapeHtml(hasBriefing ? 'Briefed' : 'Unbriefed')}</span>
          ${unseen ? '<span class="pill briefed">New</span>' : ''}
          <span class="list-title">${escapeHtml(meeting.title)}</span>
        </summary>
        <div class="card-body">
          <div class="meta">
            <span>When: ${escapeHtml(safeDate(meeting.startAt, 'Unknown'))}</span>
            <span>Organizer: ${escapeHtml(meeting.organizer)}</span>
            <span>Join: ${meetingJoinLink}</span>
          </div>
          <div class="action-row">
            <button class="small-btn primary" data-generate-briefing-id="${escapeHtml(meeting.id)}">${hasBriefing ? 'Regenerate Briefing' : 'Generate Briefing'}</button>
          </div>
          ${briefing ? `
            <div class="evidence-box">
              <h3>${escapeHtml(briefing.headline || 'Meeting Briefing')}</h3>
              <div class="panel-sub">Generated: ${escapeHtml(safeDate(briefing.generatedAt, 'Unknown'))}</div>
              <h4>Key Updates</h4>
              <ul>${keyUpdates}</ul>
              <h4>Decisions Needed</h4>
              <ul>${decisions}</ul>
              <h4>Top Risks</h4>
              <ul>${risks}</ul>
              <h4>Talk Track</h4>
              <ul>${talkTrack}</ul>
              <h4>Follow-Ups</h4>
              <ul>${followUpMarkup}</ul>
              <h4>Sources</h4>
              <ul>${sources}</ul>
            </div>
          ` : '<div class="empty">No briefing generated yet.</div>'}
        </div>
      </details>
    `;
  }).join('');

  renderKpis();
}

function buildLedgerCard(item, bucketName) {
  const people = Array.isArray(item.counterparties) && item.counterparties.length ? item.counterparties.join(', ') : 'No counterparties listed';
  const links = Array.isArray(item.evidenceLinks) ? item.evidenceLinks : [];
  const linkMarkup = links.length
    ? links.slice(0, 3).map((link, index) => `<a href="${escapeHtml(link)}" target="_blank" rel="noopener noreferrer">source ${index + 1}</a>`).join(' • ')
    : 'No source links';

  return `
    <details class="list-card">
      <summary>
        <span class="list-title">${escapeHtml(item.title || 'Untitled')}</span>
        <span class="pill monitor">${escapeHtml(bucketName)}</span>
      </summary>
      <div class="card-body">
        <p><strong>People:</strong> ${escapeHtml(people)}</p>
        <p><strong>Due:</strong> ${escapeHtml(safeDate(item.dueAt))}</p>
        <p><strong>Last signal:</strong> ${escapeHtml(safeDate(item.lastSignalAt))}</p>
        ${item.daysSilent ? `<p><strong>Days silent:</strong> ${escapeHtml(item.daysSilent)}</p>` : ''}
        <p><strong>Follow-up:</strong> ${renderMarkdownLinks(item.suggestedFollowUp || 'N/A')}</p>
        <p>${linkMarkup}</p>
        <div class="action-row">
          <button class="small-btn" data-ledger-nudge="${escapeHtml(item.id || '')}" data-ledger-title="${escapeHtml(item.title || 'Item')}">Nudge</button>
        </div>
      </div>
    </details>
  `;
}

function renderLedgerBucket(target, items, bucketName) {
  if (!items.length) {
    target.innerHTML = '<div class="empty">No entries.</div>';
    return;
  }

  target.innerHTML = items.map((item) => buildLedgerCard(item, bucketName)).join('');
}

function renderLedgerMode() {
  renderLedgerBucket(elements.ledgerIOwe, state.ledger.iOwe, 'I owe');
  renderLedgerBucket(elements.ledgerOthersOwe, state.ledger.othersOweMe, 'Owed to me');
  renderLedgerBucket(elements.ledgerSilent, state.ledger.silentThreads, 'Silent');
}
