// ── History rendering ─────────────────────────────────────────────────

function renderHistory() {
  if (!state.history.length) {
    elements.historyList.innerHTML = '<div class="empty">No audit entries yet.</div>';
    renderKpis();
    return;
  }

  elements.historyList.innerHTML = state.history.map((entry) => {
    const time = safeDate(entry.at, 'Unknown');
    const historyLinksHtml = Array.isArray(entry.payload?.newLinks) && entry.payload.newLinks.length
      ? `<ul class="source-list source-list--inline">${entry.payload.newLinks.map((e) => `<li>${escapeHtml(e.type || 'source')} &bull; <a href="${escapeHtml(e.url)}" target="_blank" rel="noreferrer">${escapeHtml(e.label || 'source')}</a></li>`).join('')}</ul>`
      : '';
    return `
      <article class="history-item">
        <div><strong>${escapeHtml(entry.kind.toUpperCase())}</strong> • ${escapeHtml(time)}</div>
        <div>${escapeHtml(entry.summary)}</div>
        ${historyLinksHtml}
      </article>
    `;
  }).join('');

  renderKpis();
}
