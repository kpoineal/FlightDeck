// ── Briefing / meeting model logic ─────────────────────────────────

function buildFallbackBriefingSources(payload) {
  const pool = [
    payload?.headline,
    ...(Array.isArray(payload?.keyUpdates) ? payload.keyUpdates : []),
    ...(Array.isArray(payload?.bullets) ? payload.bullets : []),
    ...(Array.isArray(payload?.decisionsNeeded) ? payload.decisionsNeeded : []),
    ...(Array.isArray(payload?.topRisks) ? payload.topRisks : []),
    ...(Array.isArray(payload?.talkTrack) ? payload.talkTrack : []),
    ...(Array.isArray(payload?.todayFollowUps) ? payload.todayFollowUps : []),
    ...(Array.isArray(payload?.todayPlan) ? payload.todayPlan : []),
    payload?.upcomingMeeting?.joinUrl,
  ];

  const links = [...new Set(pool.flatMap((entry) => extractExternalUrls(entry)).filter(Boolean))].slice(0, 8);

  return links.map((url, index) => ({
    label: `source ${index + 1} (${compactLinkLabel(url, 'link')})`,
    type: 'source',
    url,
  }));
}

function meetingIdentitySeed(item) {
  const title = cleanDisplayText(item?.title || '').toLowerCase();
  const organizer = cleanDisplayText(item?.organizer || '').toLowerCase();
  const startAt = String(item?.startAt || '').trim().toLowerCase();
  const endAt = String(item?.endAt || '').trim().toLowerCase();
  const joinUrl = String(normalizeExternalUrl(item?.joinUrl || '') || '').trim().toLowerCase();
  return [title, organizer, startAt, endAt, joinUrl].join('|');
}

function resolveMeetingId(item) {
  const rawId = cleanDisplayText(item?.id || '').trim();
  if (rawId) {
    return rawId;
  }

  const stableSeed = meetingIdentitySeed(item);
  if (!stableSeed.replace(/\|/g, '')) {
    return `meeting_${hashString(nowIso())}`;
  }

  return `meeting_${hashString(stableSeed)}`;
}

function briefingAlignmentScore(briefing, meeting) {
  if (!briefing || !meeting) return { score: Number.NEGATIVE_INFINITY, comparedSignals: 0 };

  const briefingMeeting = briefing.upcomingMeeting || {};
  let score = 0;
  let comparedSignals = 0;

  if (briefing.meetingId && briefing.meetingId === meeting.id) {
    score += 6;
    comparedSignals += 1;
  }

  const briefingTitle = cleanDisplayText(briefingMeeting.title || '').toLowerCase();
  const meetingTitle = cleanDisplayText(meeting.title || '').toLowerCase();
  if (briefingTitle && meetingTitle) {
    comparedSignals += 1;
    if (briefingTitle.includes(meetingTitle) || meetingTitle.includes(briefingTitle)) {
      score += 3;
    } else {
      score -= 4;
    }
  }

  const briefingStart = briefingMeeting.startAt ? new Date(briefingMeeting.startAt).getTime() : Number.NaN;
  const meetingStart = meeting.startAt ? new Date(meeting.startAt).getTime() : Number.NaN;
  if (Number.isFinite(briefingStart) && Number.isFinite(meetingStart)) {
    comparedSignals += 1;
    const deltaMs = Math.abs(briefingStart - meetingStart);
    if (deltaMs <= 10 * 60 * 1000) {
      score += 4;
    } else {
      score -= 5;
    }
  }

  const briefingOrganizer = cleanDisplayText(briefingMeeting.organizer || '').toLowerCase();
  const meetingOrganizer = cleanDisplayText(meeting.organizer || '').toLowerCase();
  if (briefingOrganizer && meetingOrganizer) {
    comparedSignals += 1;
    if (briefingOrganizer.includes(meetingOrganizer) || meetingOrganizer.includes(briefingOrganizer)) {
      score += 2;
    } else {
      score -= 2;
    }
  }

  const briefingJoinUrl = normalizeExternalUrl(briefingMeeting.joinUrl || '');
  const meetingJoinUrl = normalizeExternalUrl(meeting.joinUrl || '');
  if (briefingJoinUrl && meetingJoinUrl) {
    comparedSignals += 1;
    if (briefingJoinUrl === meetingJoinUrl) {
      score += 1;
    }
  }

  return { score, comparedSignals };
}

function isBriefingAlignedWithMeeting(briefing, meeting) {
  const { score, comparedSignals } = briefingAlignmentScore(briefing, meeting);
  return comparedSignals > 0 && score > 0;
}

function reconcileMeetingScopedState(meetings) {
  const validMeetingIds = new Set(meetings.map((meeting) => meeting.id));
  const nextBriefingsByMeetingId = {};
  const orphanBriefings = [];

  for (const [meetingId, briefing] of Object.entries(state.briefingsByMeetingId)) {
    // Preserve the day briefing key — it is not a real meeting
    if (meetingId === DAY_BRIEFING_KEY) {
      nextBriefingsByMeetingId[meetingId] = briefing;
      continue;
    }
    const keyedMeeting = meetings.find((meeting) => meeting.id === meetingId);
    if (keyedMeeting && isBriefingAlignedWithMeeting(briefing, keyedMeeting)) {
      nextBriefingsByMeetingId[meetingId] = briefing;
    } else {
      orphanBriefings.push(briefing);
    }
  }

  for (const briefing of orphanBriefings) {
    let bestMeeting = null;
    let bestScore = Number.NEGATIVE_INFINITY;

    for (const meeting of meetings) {
      if (nextBriefingsByMeetingId[meeting.id]) continue;
      const { score } = briefingAlignmentScore(briefing, meeting);
      if (score > bestScore) {
        bestScore = score;
        bestMeeting = meeting;
      }
    }

    if (bestMeeting && bestScore > 0) {
      nextBriefingsByMeetingId[bestMeeting.id] = briefing;
    }
  }

  state.briefingsByMeetingId = nextBriefingsByMeetingId;

  // Prune briefingSeenAt to only keep keys that still exist in briefingsByMeetingId or current meetings
  const activeMeetingIds = new Set([
    ...Object.keys(nextBriefingsByMeetingId),
    ...meetings.map((m) => m.id),
    DAY_BRIEFING_KEY,
  ]);
  for (const seenId of Object.keys(state.briefingSeenAt)) {
    if (!activeMeetingIds.has(seenId)) {
      delete state.briefingSeenAt[seenId];
    }
  }
}

function applyMeetingsPayload(payload) {
  const meetings = Array.isArray(payload?.meetings) ? payload.meetings : [];
  const now = Date.now();

  state.meetings = meetings
    .map((item) => {
      const startAt = item.startAt || null;
      const startTime = startAt ? new Date(startAt).getTime() : Number.NaN;
      const id = resolveMeetingId(item);

      return {
        id,
        title: cleanDisplayText(item.title || 'Untitled meeting'),
        startAt,
        endAt: item.endAt || null,
        organizer: cleanDisplayText(item.organizer || 'Unknown organizer'),
        joinUrl: normalizeExternalUrl(item.joinUrl || ''),
        startTime,
      };
    })
    .filter((item) => Number.isFinite(item.startTime) && item.startTime >= now)
    .sort((a, b) => a.startTime - b.startTime);

  reconcileMeetingScopedState(state.meetings);
  state.meetingsLastFetched = Date.now();
  savePersistentState();
}

function applyBriefingPayload(payload, meetingId = null) {
  const meeting = payload.upcomingMeeting || {};
  const explicitSources = Array.isArray(payload.sources)
    ? payload.sources
      .map((entry) => ({
        label: sanitizeBriefingText(entry?.label || 'Source'),
        type: sanitizeBriefingText(entry?.type || 'source'),
        url: normalizeExternalUrl(entry?.url || ''),
      }))
      .filter((entry) => entry.url)
    : [];

  const fallbackSources = buildFallbackBriefingSources(payload);
  const normalizedSources = explicitSources.length ? explicitSources : fallbackSources;

  const meetingJoinUrl = normalizeExternalUrl(meeting.joinUrl || '')
    || normalizedSources.find((entry) => /teams\.microsoft\.com/i.test(entry.url))?.url
    || normalizedSources[0]?.url
    || null;

  const normalizedBriefing = {
    meetingId: null,
    headline: sanitizeBriefingText(payload.headline || 'Briefing unavailable'),
    upcomingMeeting: {
      id: null,
      title: sanitizeBriefingText(meeting.title || 'Upcoming meeting not identified'),
      startAt: meeting.startAt || null,
      organizer: sanitizeBriefingText(meeting.organizer || 'Unknown organizer'),
      joinUrl: meetingJoinUrl,
    },
    bullets: Array.isArray(payload.bullets)
      ? payload.bullets.map(sanitizeBriefingText)
      : Array.isArray(payload.keyUpdates)
        ? payload.keyUpdates.map(sanitizeBriefingText)
        : [],
    keyUpdates: Array.isArray(payload.keyUpdates) ? payload.keyUpdates.map(sanitizeBriefingText) : [],
    decisionsNeeded: Array.isArray(payload.decisionsNeeded) ? payload.decisionsNeeded.map(sanitizeBriefingText) : [],
    topRisks: Array.isArray(payload.topRisks) ? payload.topRisks.map(sanitizeBriefingText) : [],
    talkTrack: Array.isArray(payload.talkTrack) ? payload.talkTrack.map(sanitizeBriefingText) : [],
    todayPlan: Array.isArray(payload.todayPlan)
      ? payload.todayPlan.map(sanitizeBriefingText)
      : Array.isArray(payload.todayFollowUps)
        ? payload.todayFollowUps.map(sanitizeBriefingText)
        : [],
    todayFollowUps: Array.isArray(payload.todayFollowUps) ? payload.todayFollowUps.map(sanitizeBriefingText) : [],
    sources: normalizedSources,
    generatedAt: payload.generatedAt || nowIso(),
  };

  state.briefing = normalizedBriefing;

  const resolvedMeetingId = meetingId || meeting.id || null;
  if (resolvedMeetingId) {
    const resolvedMeeting = state.meetings.find((entry) => entry.id === resolvedMeetingId) || null;
    normalizedBriefing.meetingId = resolvedMeetingId;
    normalizedBriefing.upcomingMeeting.id = resolvedMeetingId;
    if (resolvedMeeting) {
      normalizedBriefing.upcomingMeeting.title = resolvedMeeting.title;
      normalizedBriefing.upcomingMeeting.startAt = resolvedMeeting.startAt;
      normalizedBriefing.upcomingMeeting.organizer = resolvedMeeting.organizer;
      normalizedBriefing.upcomingMeeting.joinUrl = resolvedMeeting.joinUrl || normalizedBriefing.upcomingMeeting.joinUrl;
    }

    state.briefingsByMeetingId[resolvedMeetingId] = normalizedBriefing;
    savePersistentState();
  }
}

function getBriefingForMeeting(meeting) {
  const stored = state.briefingsByMeetingId[meeting.id] || null;
  return stored && isBriefingAlignedWithMeeting(stored, meeting) ? stored : null;
}

function isBriefingUnseen(meetingId, briefing) {
  if (!briefing) return false;
  const seenAt = state.briefingSeenAt[meetingId];
  if (!seenAt) return true;
  return new Date(briefing.generatedAt).getTime() > new Date(seenAt).getTime();
}

function markBriefingSeen(meetingId) {
  const briefing = state.briefingsByMeetingId[meetingId];
  if (!briefing) return;
  const seenAt = state.briefingSeenAt[meetingId];
  if (seenAt && new Date(seenAt).getTime() >= new Date(briefing.generatedAt).getTime()) return;
  state.briefingSeenAt[meetingId] = nowIso();
  savePersistentState();
  renderBriefingsMode();
}

function classifyBriefingSeverity(meeting, briefing) {
  return briefing ? 'briefed' : 'unbriefed';
}

async function generateBriefingForMeeting(meetingId, triggerButton = null) {
  const meeting = state.meetings.find((entry) => entry.id === meetingId);
  if (!meeting) return;

  setDraftButtonLoading(triggerButton, true);
  setStatus('Generating meeting briefing...');
  addHistory('recommendation', `Briefing generation requested for: ${meeting.title}`, { meetingId });

  try {
    const payload = await runWorkiqJson(
      buildMeetingBriefingPrompt(meeting),
      (candidate) => candidate && typeof candidate.headline === 'string' && Array.isArray(candidate.keyUpdates),
      'meeting-briefing'
    );

    if (!payload.upcomingMeeting || typeof payload.upcomingMeeting !== 'object') {
      payload.upcomingMeeting = {};
    }
    payload.upcomingMeeting.id = payload.upcomingMeeting.id || meeting.id;
    payload.upcomingMeeting.title = payload.upcomingMeeting.title || meeting.title;
    payload.upcomingMeeting.startAt = payload.upcomingMeeting.startAt || meeting.startAt;
    payload.upcomingMeeting.organizer = payload.upcomingMeeting.organizer || meeting.organizer;
    payload.upcomingMeeting.joinUrl = payload.upcomingMeeting.joinUrl || meeting.joinUrl;

    applyBriefingPayload(payload, meeting.id);
    addHistory('scan', `Briefing generated for: ${meeting.title}`, { meetingId });
    setStatus('Briefing ready');
    renderBriefingsMode();
  } catch (error) {
    addHistory('failure', `Briefing generation failed for ${meeting.title}: ${error.message}`, { meetingId });
    setStatus('Briefing failed');
    alert(`Unable to generate briefing:\n${error.message}`);
  } finally {
    setDraftButtonLoading(triggerButton, false);
  }
}

// ── Day Briefing helpers ─────────────────────────────────────────────

function applyDayBriefingPayload(payload) {
  const explicitSources = Array.isArray(payload.sources)
    ? payload.sources
      .map((entry) => ({
        label: sanitizeBriefingText(entry?.label || 'Source'),
        type: sanitizeBriefingText(entry?.type || 'source'),
        url: normalizeExternalUrl(entry?.url || ''),
      }))
      .filter((entry) => entry.url)
    : [];

  const normalizedDayBriefing = {
    headline: sanitizeBriefingText(payload.headline || 'Your day at a glance'),
    topPriorities: Array.isArray(payload.topPriorities)
      ? payload.topPriorities.map(sanitizeBriefingText)
      : [],
    meetingsRequiringPrep: Array.isArray(payload.meetingsRequiringPrep)
      ? payload.meetingsRequiringPrep.map((m) => ({
          title: sanitizeBriefingText(m?.title || 'Meeting'),
          startAt: m?.startAt || null,
          whyPrepNeeded: sanitizeBriefingText(m?.whyPrepNeeded || ''),
        }))
      : [],
    atRiskItems: Array.isArray(payload.atRiskItems)
      ? payload.atRiskItems.map((item) => ({
          title: sanitizeBriefingText(item?.title || 'Item'),
          severity: sanitizeBriefingText(item?.severity || 'Observe'),
          risk: sanitizeBriefingText(item?.risk || ''),
        }))
      : [],
    suggestedTimeBlocks: Array.isArray(payload.suggestedTimeBlocks)
      ? payload.suggestedTimeBlocks.map((block) => ({
          time: sanitizeBriefingText(block?.time || ''),
          activity: sanitizeBriefingText(block?.activity || ''),
          rationale: sanitizeBriefingText(block?.rationale || ''),
        }))
      : [],
    todayFollowUps: Array.isArray(payload.todayFollowUps)
      ? payload.todayFollowUps.map(sanitizeBriefingText)
      : [],
    sources: explicitSources,
    generatedAt: payload.generatedAt || nowIso(),
  };

  state.briefingsByMeetingId[DAY_BRIEFING_KEY] = normalizedDayBriefing;
  savePersistentState();
}

function getDayBriefing() {
  return state.briefingsByMeetingId[DAY_BRIEFING_KEY] || null;
}

async function generateDayBriefing(triggerButton = null) {
  setDraftButtonLoading(triggerButton, true);
  setStatus('Generating day briefing...');
  addHistory('recommendation', 'Day briefing generation requested');

  try {
    const payload = await runWorkiqJson(
      buildDayBriefingPrompt(),
      (candidate) => candidate && typeof candidate.headline === 'string' && Array.isArray(candidate.topPriorities),
      'day-briefing'
    );

    applyDayBriefingPayload(payload);
    addHistory('scan', 'Day briefing generated.');
    setStatus('Day briefing ready');
    renderBriefingsMode();
  } catch (error) {
    addHistory('failure', `Day briefing generation failed: ${error.message}`);
    setStatus('Day briefing failed');
    alert(`Unable to generate day briefing:\n${error.message}`);
  } finally {
    setDraftButtonLoading(triggerButton, false);
  }
}
