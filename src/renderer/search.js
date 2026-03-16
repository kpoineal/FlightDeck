// ── Global search ──────────────────────────────────────────────────

let _searchActiveIndex = -1;

function fuzzyMatch(text, query) {
  const lower = text.toLowerCase();
  const q = query.toLowerCase();
  // Simple substring + token match
  if (lower.includes(q)) return { match: true, score: lower.indexOf(q) === 0 ? 2 : 1 };
  // Token match: every word in query appears somewhere in text
  const tokens = q.split(/\s+/).filter(Boolean);
  if (tokens.length > 1 && tokens.every((t) => lower.includes(t))) {
    return { match: true, score: 0.5 };
  }
  return { match: false, score: 0 };
}

function highlightMatch(text, query) {
  if (!query) return escapeHtml(text);
  const escaped = escapeHtml(text);
  const q = query.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(`(${q})`, 'gi');
  return escaped.replace(re, '<mark>$1</mark>');
}

function gatherSearchItems() {
  const results = [];

  // Radar items (inbound only)
  for (const item of (state.radarItems || [])) {
    if (!isInboundStatus(item.status)) continue;
    if (state.trackingItems.some((t) => t.id === item.id)) continue;
    results.push({
      type: 'radar',
      id: item.id,
      title: item.title || '',
      meta: [item.severity, item.owner, item.sourceType].filter(Boolean).join(' · '),
      summary: item.summary || '',
    });
  }

  // Tracking items
  for (const item of (state.trackingItems || [])) {
    results.push({
      type: 'tracker',
      id: item.id,
      title: item.title || '',
      meta: [item.severity, item.owner, item.sourceType].filter(Boolean).join(' · '),
      summary: item.summary || '',
    });
  }

  // Briefings (by meeting)
  for (const meeting of (state.meetings || [])) {
    const briefing = state.briefingsByMeetingId?.[meeting.id];
    results.push({
      type: 'briefing',
      id: meeting.id,
      title: meeting.title || '',
      meta: [meeting.organizer, meeting.startAt ? new Date(meeting.startAt).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : null].filter(Boolean).join(' · '),
      summary: briefing?.headline || '',
    });
  }

  return results;
}

function runSearch(query) {
  const trimmed = (query || '').trim();
  if (!trimmed) {
    closeSearch();
    return;
  }

  const allItems = gatherSearchItems();
  const matches = [];
  for (const item of allItems) {
    const titleMatch = fuzzyMatch(item.title, trimmed);
    const metaMatch = fuzzyMatch(item.meta, trimmed);
    const summaryMatch = fuzzyMatch(item.summary, trimmed);
    const best = Math.max(titleMatch.score, metaMatch.score * 0.8, summaryMatch.score * 0.6);
    if (titleMatch.match || metaMatch.match || summaryMatch.match) {
      matches.push({ ...item, score: best });
    }
  }

  matches.sort((a, b) => b.score - a.score);
  const capped = matches.slice(0, 20);

  if (!capped.length) {
    elements.searchResults.innerHTML = '<div class="search-empty">No matching items</div>';
    elements.searchResults.classList.add('show');
    elements.searchOverlay.classList.add('show');
    _searchActiveIndex = -1;
    return;
  }

  elements.searchResults.innerHTML = capped.map((item, i) => `
    <div class="search-result-item${i === 0 ? ' is-active' : ''}" data-search-idx="${i}" data-search-type="${escapeHtml(item.type)}" data-search-id="${escapeHtml(item.id)}">
      <span class="search-result-type ${escapeHtml(item.type)}">${item.type === 'tracker' ? 'Track' : item.type === 'briefing' ? 'Brief' : 'Radar'}</span>
      <div class="search-result-body">
        <div class="search-result-title">${highlightMatch(item.title, trimmed)}</div>
        <div class="search-result-meta">${highlightMatch(item.meta + (item.summary ? ' — ' + item.summary : ''), trimmed)}</div>
      </div>
    </div>
  `).join('');

  elements.searchResults.classList.add('show');
  elements.searchOverlay.classList.add('show');
  _searchActiveIndex = 0;
}

function navigateSearchResult(item) {
  if (!item) return;
  const type = item.dataset.searchType;
  const id = item.dataset.searchId;
  closeSearch();

  if (type === 'radar') {
    setMode('Radar');
    state.selectedRadarItemId = id;
    renderRadarMode();
    requestAnimationFrame(() => {
      // Full card view
      const card = document.querySelector(`.radar-card[data-radar-id="${CSS.escape(id)}"]`);
      if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); flashHighlight(card); return; }
      // Minimal row view — expand the row
      const wrapper = document.querySelector(`.radar-row-wrapper[data-radar-id="${CSS.escape(id)}"]`);
      if (wrapper) {
        const row = wrapper.querySelector('.radar-row');
        const detail = wrapper.querySelector('.radar-row-detail');
        const chevron = row?.querySelector('.row-expand-chevron');
        const currentlyOpen = elements.radarList.querySelector('.radar-row-detail.show');
        if (currentlyOpen && currentlyOpen !== detail) {
          currentlyOpen.classList.remove('show');
          const otherRow = currentlyOpen.parentElement?.querySelector('.radar-row');
          if (otherRow) { otherRow.classList.remove('expanded'); const oc = otherRow.querySelector('.row-expand-chevron'); if (oc) oc.classList.remove('open'); }
        }
        if (detail && !detail.classList.contains('show')) {
          detail.classList.add('show');
          if (row) row.classList.add('expanded');
          if (chevron) chevron.classList.add('open');
        }
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        flashHighlight(wrapper);
      }
    });
  } else if (type === 'tracker') {
    setMode('Tracking');
    requestAnimationFrame(() => {
      // Full card view
      const card = document.querySelector(`.tracker-card[data-tracker-id="${CSS.escape(id)}"]`);
      if (card) { card.scrollIntoView({ behavior: 'smooth', block: 'nearest' }); flashHighlight(card); return; }
      // Minimal row view — expand the row
      const wrapper = document.querySelector(`.tracker-row-wrapper[data-tracker-id="${CSS.escape(id)}"]`);
      if (wrapper) {
        const row = wrapper.querySelector('.tracker-row');
        const detail = wrapper.querySelector('.tracker-row-detail');
        const chevron = row?.querySelector('.row-expand-chevron');
        // Collapse any other open row first
        const currentlyOpen = elements.trackingList.querySelector('.tracker-row-detail.show');
        if (currentlyOpen && currentlyOpen !== detail) {
          currentlyOpen.classList.remove('show');
          const otherRow = currentlyOpen.parentElement?.querySelector('.tracker-row');
          if (otherRow) { otherRow.classList.remove('expanded'); const oc = otherRow.querySelector('.row-expand-chevron'); if (oc) oc.classList.remove('open'); }
        }
        if (detail && !detail.classList.contains('show')) {
          detail.classList.add('show');
          if (row) row.classList.add('expanded');
          if (chevron) chevron.classList.add('open');
        }
        wrapper.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        flashHighlight(wrapper);
      }
    });
  } else if (type === 'briefing') {
    setMode('Briefings');
    if (!state.expandedBriefingMeetingIds.includes(id)) {
      state.expandedBriefingMeetingIds.push(id);
    }
    renderBriefingsMode();
    requestAnimationFrame(() => {
      const details = document.querySelector(`details[data-briefing-meeting-id="${CSS.escape(id)}"]`);
      if (details) {
        details.open = true;
        details.scrollIntoView({ behavior: 'smooth', block: 'nearest' });
        flashHighlight(details);
      }
    });
  }
}

function flashHighlight(el) {
  el.classList.remove('search-highlight');
  // Force reflow so re-adding the class restarts the animation
  void el.offsetWidth;
  el.classList.add('search-highlight');
  el.addEventListener('animationend', () => el.classList.remove('search-highlight'), { once: true });
}

function closeSearch() {
  elements.searchResults.classList.remove('show');
  elements.searchOverlay.classList.remove('show');
  elements.globalSearch.value = '';
  _searchActiveIndex = -1;
}

function moveSearchSelection(delta) {
  const items = elements.searchResults.querySelectorAll('.search-result-item');
  if (!items.length) return;
  items.forEach((el) => el.classList.remove('is-active'));
  _searchActiveIndex = (_searchActiveIndex + delta + items.length) % items.length;
  items[_searchActiveIndex].classList.add('is-active');
  items[_searchActiveIndex].scrollIntoView({ block: 'nearest' });
}

function initSearch() {
  let debounceTimer = null;

  elements.globalSearch.addEventListener('input', () => {
    clearTimeout(debounceTimer);
    debounceTimer = setTimeout(() => runSearch(elements.globalSearch.value), 120);
  });

  elements.globalSearch.addEventListener('keydown', (e) => {
    if (e.key === 'ArrowDown') { e.preventDefault(); moveSearchSelection(1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); moveSearchSelection(-1); }
    else if (e.key === 'Enter') {
      e.preventDefault();
      const active = elements.searchResults.querySelector('.search-result-item.is-active');
      if (active) navigateSearchResult(active);
    }
    else if (e.key === 'Escape') { closeSearch(); elements.globalSearch.blur(); }
  });

  elements.searchResults.addEventListener('click', (e) => {
    const item = e.target.closest('.search-result-item');
    if (item) navigateSearchResult(item);
  });

  elements.searchOverlay.addEventListener('click', closeSearch);

  // Global Ctrl+K shortcut
  document.addEventListener('keydown', (e) => {
    if ((e.ctrlKey || e.metaKey) && e.key === 'k') {
      e.preventDefault();
      elements.globalSearch.focus();
      elements.globalSearch.select();
    }
  });
}
