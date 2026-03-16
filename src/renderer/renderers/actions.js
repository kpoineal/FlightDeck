// ── Action rendering, draft generation, confirm modal ────────────────

function getItemContextById(itemId) {
  if (!itemId) return null;

  // Prefer tracked items — they are persistent, user-curated data.
  // Radar items are transient scan results whose LLM-assigned IDs can
  // be reused across scans for completely different items, so checking
  // radarItems first could return the wrong item context.
  return state.trackingItems.find((item) => item.id === itemId)
    || state.radarItems.find((item) => item.id === itemId)
    || null;
}

function getActionsForItem(itemId) {
  const item = getItemContextById(itemId);
  if (!item) return [];

  const linked = state.actions.filter((action) => action.radarItemId === item.id);
  if (linked.length) return linked;

  const fallback = [
    { id: `fb_${item.id}_1`, radarItemId: item.id, label: 'Draft Reply', actionType: 'DraftReply', draftText: '', risk: { level: 'medium', isBulk: false, targetCount: 1, reason: 'External thread' }, requiresConfirmation: true, status: 'Proposed' },
    { id: `fb_${item.id}_2`, radarItemId: item.id, label: 'Create To-Do', actionType: 'CreateTodo', draftText: '', risk: { level: 'low', isBulk: false, targetCount: 1, reason: 'Task creation' }, requiresConfirmation: false, status: 'Proposed' },
    { id: `fb_${item.id}_3`, radarItemId: item.id, label: 'Schedule 15-min', actionType: 'Schedule15', draftText: '', risk: { level: 'medium', isBulk: false, targetCount: 2, reason: 'Calendar impact' }, requiresConfirmation: true, status: 'Proposed' },
    { id: `fb_${item.id}_4`, radarItemId: item.id, label: 'Nudge', actionType: 'Nudge', draftText: '', risk: { level: 'low', isBulk: false, targetCount: 1, reason: 'Follow-up prompt' }, requiresConfirmation: false, status: 'Proposed' },
  ];

  return fallback;
}

function getActionsForSelected() {
  const selected = getSelectedRadarItem();
  if (!selected) return [];
  return getActionsForItem(selected.id);
}

function buildRunwayMarkupForItem(item) {
  if (!item || !item.id) {
    return '<div class="empty">No item selected.</div>';
  }

  const actions = getActionsForItem(item.id);
  if (!actions.length) {
    return '<div class="empty">No suggested actions.</div>';
  }

  return actions.map((action) => {
    const riskClass = action.risk.level === 'high' ? 'critical' : action.risk.level === 'medium' ? 'elevated' : 'observe';
    const tone = elements.toneSelect?.value || 'neutral';
    const draft = cleanDisplayText(action.draftText || `(${tone}) Suggested ${action.actionType} for: ${item.title}`);

    return `
      <details class="list-card">
        <summary>
          <span class="list-title">${escapeHtml(action.label)}</span>
          <span class="pill ${riskClass}">${escapeHtml(action.risk.level.toUpperCase())}</span>
        </summary>
        <div class="card-body">
          <p><strong>Type:</strong> ${escapeHtml(action.actionType)}</p>
          <p><strong>Draft:</strong> ${renderMarkdownLinks(draft)}</p>
          <p><strong>Risk reason:</strong> ${renderMarkdownLinks(action.risk.reason || 'None')}</p>
          <div class="meta">
            <span>Bulk: ${action.risk.isBulk ? 'Yes' : 'No'}</span>
            <span>Targets: ${action.risk.targetCount}</span>
            <span>Confirmation: ${action.requiresConfirmation ? 'Required' : 'Not required'}</span>
          </div>
          <div class="action-row">
            <button class="small-btn primary" data-draft-action-id="${escapeHtml(action.id)}" data-draft-item-id="${escapeHtml(item.id)}">Create Draft</button>
          </div>
        </div>
      </details>
    `;
  }).join('');
}

function sanitizeDraftField(value) {
  return normalizeSpacingArtifacts(String(value || '')
    .replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/gi, '$1')
    .replace(/https?:\/\/[\w\-._~:/?#[\]@!$&'()*+,;=%]+/gi, '')
    .replace(/\*\*/g, '')
    .replace(/`/g, '')
    .replace(/\b(?:draft\s*body|next-step\s*ask|instructions?)\b\s*:?/gi, '')
    .replace(/\s{2,}/g, ' ')
    .trim());
}

function toSentenceCaseLine(value) {
  const text = sanitizeDraftField(value);
  if (!text) return '';
  return text.charAt(0).toUpperCase() + text.slice(1);
}

function setDraftButtonLoading(button, isLoading) {
  if (!button) return;

  if (isLoading) {
    button.dataset.originalLabel = button.textContent || 'Create Draft';
    button.disabled = true;
    button.classList.add('is-loading');
    button.textContent = 'Generating...';
    return;
  }

  button.disabled = false;
  button.classList.remove('is-loading');
  button.textContent = button.dataset.originalLabel || 'Create Draft';
  delete button.dataset.originalLabel;
}

async function generateActionDraft(actionId, itemId = null, triggerButton = null) {
  const targetItem = getItemContextById(itemId) || getSelectedRadarItem();
  if (!targetItem) {
    alert('Select or track an item first.');
    return;
  }

  const action = getActionsForItem(targetItem.id).find((entry) => entry.id === actionId);
  if (!action) {
    return;
  }

  const tone = elements.toneSelect?.value || 'neutral';
  const evidenceItems = state.evidence
    .filter((item) => item.radarItemId === targetItem.id)
    .slice(0, 3);

  addHistory('recommendation', `Draft generation requested: ${action.label}`, { actionId: action.id });
  setStatus('Generating draft...');
  setDraftButtonLoading(triggerButton, true);

  try {
    const prompt = buildActionDraftPrompt(targetItem, action, tone, evidenceItems);
    const payload = await runWorkiqJson(
      prompt,
      (candidate) => candidate && typeof candidate.subject === 'string' && typeof candidate.body === 'string',
      'draft'
    );

    const subject = toSentenceCaseLine(payload.subject || action.label || 'Follow-up');
    const body = toSentenceCaseLine(payload.body || `I want to align on ${targetItem.title}. Please share current status and any blockers.`);
    const nextStepAsk = toSentenceCaseLine(payload.nextStepAsk || 'Please confirm owner, timing, and next step.');
    const recipients = Array.isArray(payload.suggestedRecipients)
      ? payload.suggestedRecipients.map(toSentenceCaseLine).filter(Boolean)
      : [];

    const recipientsLine = recipients.length ? recipients.join(', ') : (targetItem.counterparties || []).join(', ');
    const markdown = `## Subject\n${subject}\n\n## Message\n${body}\n\n## Next Step Ask\n${nextStepAsk}${recipientsLine ? `\n\n## Suggested Recipients\n${recipientsLine}` : ''}`;
    const instructions = `- Review and edit this draft.\n- Validate recipients and source context before sending.\n- Send manually when ready.`;

    window.workiq.openMarkdownWindow({
      title: `Draft - ${action.label}`,
      markdown,
      instructions,
    });

    addHistory('execution', `Draft generated: ${action.label}`, { actionId: action.id, mode: 'workiq-live' });
    setStatus('Draft ready');
  } catch (error) {
    addHistory('failure', `Draft generation failed: ${error.message}`, { actionId: action.id });
    setStatus('Draft failed');
    alert(`Unable to generate draft:\n${error.message}`);
  } finally {
    setDraftButtonLoading(triggerButton, false);
  }
}

function buildEvidenceMarkupForItem(item) {
  if (!item || !item.id) {
    return '<div class="empty">No evidence available.</div>';
  }

  const linkedEvidence = state.evidence.filter((entry) => entry.radarItemId === item.id);
  const whyItems = linkedEvidence.length
    ? linkedEvidence
    : [{ sourceLabel: 'Derived from tracked item', snippet: item.reason || item.summary || 'No explanation provided.', citationUrl: null, sourceType: 'context', confidence: 0.5 }];

  const citations = whyItems.map((item) => {
    const occurred = safeDate(item.occurredAt, 'Unknown');
    const confidence = typeof item.confidence === 'number' ? `${Math.round(item.confidence * 100)}%` : 'n/a';
    const citation = item.citationUrl
      ? `<a href="${escapeHtml(item.citationUrl)}" target="_blank" rel="noreferrer">Open source</a>`
      : '<span>No direct link</span>';
    return `<li>${escapeHtml(item.sourceLabel)} • ${escapeHtml(item.sourceType || 'source')} • ${escapeHtml(occurred)} • confidence ${escapeHtml(confidence)} — ${citation}<br/><strong>Snippet:</strong> ${renderMarkdownLinks(item.snippet || '')}</li>`;
  }).join('');

  return `
    <div class="evidence-box">
      <h3>Why this is prioritized</h3>
      <ul>
        <li>${renderMarkdownLinks(item.reason || item.summary || 'No reason provided.')}</li>
        <li>Severity: ${escapeHtml(item.severity)}</li>
        <li>Due: ${escapeHtml(safeDate(item.dueAt))}</li>
      </ul>
    </div>
    <div class="evidence-box">
      <h3>Citations</h3>
      <ul>${citations}</ul>
    </div>
  `;
}

function openConfirmModal(action) {
  state.pendingConfirmAction = action;
  const selected = getSelectedRadarItem();

  elements.confirmSummary.textContent = `Action "${action.label}" is ${action.risk.level} risk and may affect ${action.risk.targetCount} target(s).`;
  elements.confirmTargets.innerHTML = `
    <div><strong>Reason:</strong> ${escapeHtml(action.risk.reason || 'Not specified')}</div>
    <div><strong>Radar item:</strong> ${escapeHtml(selected?.title || action.radarItemId || 'Unknown')}</div>
    <div><strong>Bulk:</strong> ${action.risk.isBulk ? 'Yes' : 'No'}</div>
  `;

  elements.confirmModal.classList.add('show');
}

function closeConfirmModal() {
  state.pendingConfirmAction = null;
  elements.confirmModal.classList.remove('show');
}

function executeAction(action) {
  addHistory('execution', `Executed action: ${action.label}`, { actionId: action.id, risk: action.risk.level });

  const selected = getSelectedRadarItem();
  const tone = getSelectedTone();
  const draft = cleanDisplayText(action.draftText || `(${tone}) Suggested ${action.actionType} for: ${selected?.title || 'selected item'}`);

  const markdown = `## ${action.label}\n\n${draft}\n\n- Type: ${action.actionType}\n- Risk: ${action.risk.level}\n- Targets: ${action.risk.targetCount}`;
  const instructions = `- Review and edit this draft.\n- Confirm recipients and source context.\n- Execute manually after user confirmation.\n- Keep audit notes in History.`;

  window.workiq.openMarkdownWindow({
    title: `Action Draft - ${action.label}`,
    markdown,
    instructions,
  });
}

function requestActionExecution(actionId) {
  const selected = getSelectedRadarItem();
  const action = selected ? getActionsForItem(selected.id).find((entry) => entry.id === actionId) : null;
  if (!action) {
    return;
  }

  const needsConfirmation = action.requiresConfirmation || action.risk.level !== 'low' || action.risk.isBulk;

  addHistory('recommendation', `Recommended action: ${action.label}`, { actionId: action.id });

  if (needsConfirmation) {
    addHistory('confirmation', `Confirmation requested for action: ${action.label}`, { actionId: action.id });
    openConfirmModal(action);
    return;
  }

  executeAction(action);
}

async function generateSuggestionDraft(suggestionText, itemId, triggerButton = null) {
  const targetItem = getItemContextById(itemId);
  if (!targetItem) {
    alert('Could not find the tracked item for this suggestion.');
    return;
  }

  const tone = elements.toneSelect?.value || 'neutral';
  const evidenceItems = state.evidence
    .filter((item) => item.radarItemId === targetItem.id)
    .slice(0, 3);

  addHistory('recommendation', `Draft from suggestion: ${suggestionText}`, { itemId: targetItem.id });
  setStatus('Generating draft from suggestion...');
  setDraftButtonLoading(triggerButton, true);

  try {
    const prompt = buildSuggestionDraftPrompt(targetItem, suggestionText, tone, evidenceItems);
    const payload = await runWorkiqJson(
      prompt,
      (candidate) => candidate && typeof candidate.subject === 'string' && typeof candidate.body === 'string',
      'draft'
    );

    const subject = toSentenceCaseLine(payload.subject || suggestionText);
    const body = toSentenceCaseLine(payload.body || `Following up regarding ${targetItem.title}.`);
    const nextStepAsk = toSentenceCaseLine(payload.nextStepAsk || 'Please confirm next steps.');
    const recipients = Array.isArray(payload.suggestedRecipients)
      ? payload.suggestedRecipients.map(toSentenceCaseLine).filter(Boolean)
      : [];

    const recipientsLine = recipients.length ? recipients.join(', ') : (targetItem.counterparties || []).join(', ');
    const markdown = `## Subject\n${subject}\n\n## Message\n${body}\n\n## Next Step Ask\n${nextStepAsk}${recipientsLine ? `\n\n## Suggested Recipients\n${recipientsLine}` : ''}`;
    const instructions = `- Review and edit this draft.\n- Validate recipients and source context before sending.\n- Send manually when ready.`;

    window.workiq.openMarkdownWindow({
      title: `Draft - ${suggestionText.slice(0, 60)}`,
      markdown,
      instructions,
    });

    addHistory('execution', `Draft generated from suggestion: ${suggestionText}`, { itemId: targetItem.id, mode: 'workiq-live' });
    setStatus('Draft ready');
  } catch (error) {
    addHistory('failure', `Suggestion draft failed: ${error.message}`, { itemId: targetItem.id });
    setStatus('Draft failed');
    alert(`Unable to generate draft:\n${error.message}`);
  } finally {
    setDraftButtonLoading(triggerButton, false);
  }
}

async function handleLedgerNudge(id, title, triggerButton = null) {
  const summary = `Generated nudge for ledger item: ${title}`;
  addHistory('recommendation', summary, { ledgerId: id });
  setStatus('Generating nudge...');
  setDraftButtonLoading(triggerButton, true);

  try {
    const markdown = `## Nudge Draft\n\n### Subject\nQuick follow-up on ${title}\n\n### Draft\nHi — following up on this thread. Can you share status and next step by EOD?\n\nThanks.`;
    const instructions = `- Validate the recipient and thread context.\n- Keep content concise and action-oriented.\n- Send manually once reviewed.`;

    await window.workiq.openMarkdownWindow({
      title: `Nudge Draft - ${title}`,
      markdown,
      instructions,
    });

    setStatus('Draft ready');
  } catch (error) {
    addHistory('failure', `Nudge draft failed: ${error.message}`, { ledgerId: id });
    setStatus('Draft failed');
    alert(`Unable to generate nudge draft:\n${error.message}`);
  } finally {
    setDraftButtonLoading(triggerButton, false);
  }
}
