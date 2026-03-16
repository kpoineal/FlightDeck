'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const { createRendererContext, loadFile } = require('./helpers/renderer-context');

let ctx;

before(() => {
  ctx = createRendererContext({
    // Stubs for globals that briefing.js calls but we don't test here
    state: {
      meetings: [],
      briefing: null,
      briefingsByMeetingId: {},
      briefingSeenAt: {},
    },
    savePersistentState: () => {},
    renderBriefingsMode: () => {},
    setStatus: () => {},
    addHistory: () => {},
    setDraftButtonLoading: () => {},
    runWorkiqJson: () => Promise.resolve({}),
    buildMeetingBriefingPrompt: () => '',
  });
  loadFile(ctx, 'renderer/constants.js');
  loadFile(ctx, 'renderer/utils.js');
  loadFile(ctx, 'renderer/models/briefing.js');
});

/* ================================================================== */
/*  briefingAlignmentScore                                            */
/* ================================================================== */
describe('briefingAlignmentScore()', () => {
  it('returns negative infinity for null inputs', () => {
    const result = ctx.briefingAlignmentScore(null, null);
    assert.equal(result.score, Number.NEGATIVE_INFINITY);
    assert.equal(result.comparedSignals, 0);
  });

  it('scores +6 when meetingId matches', () => {
    const briefing = { meetingId: 'mtg1', upcomingMeeting: {} };
    const meeting = { id: 'mtg1' };
    const { score } = ctx.briefingAlignmentScore(briefing, meeting);
    assert.ok(score >= 6);
  });

  it('scores +3 for matching titles', () => {
    const briefing = { upcomingMeeting: { title: 'Sprint Planning' } };
    const meeting = { title: 'Sprint Planning' };
    const { score, comparedSignals } = ctx.briefingAlignmentScore(briefing, meeting);
    assert.ok(score >= 3);
    assert.ok(comparedSignals >= 1);
  });

  it('penalizes mismatched titles', () => {
    const briefing = { upcomingMeeting: { title: 'Sprint Planning' } };
    const meeting = { title: 'Budget Review' };
    const { score } = ctx.briefingAlignmentScore(briefing, meeting);
    assert.ok(score < 0);
  });

  it('scores +4 for close start times', () => {
    const briefing = { upcomingMeeting: { startAt: '2025-06-15T10:00:00Z' } };
    const meeting = { startAt: '2025-06-15T10:05:00Z' };
    const { score } = ctx.briefingAlignmentScore(briefing, meeting);
    assert.ok(score >= 4);
  });

  it('penalizes distant start times', () => {
    const briefing = { upcomingMeeting: { startAt: '2025-06-15T10:00:00Z' } };
    const meeting = { startAt: '2025-06-15T14:00:00Z' };
    const { score } = ctx.briefingAlignmentScore(briefing, meeting);
    assert.ok(score < 0);
  });

  it('scores +2 for matching organizers', () => {
    const briefing = { upcomingMeeting: { organizer: 'Alice Smith' } };
    const meeting = { organizer: 'Alice Smith' };
    const { score } = ctx.briefingAlignmentScore(briefing, meeting);
    assert.ok(score >= 2);
  });

  it('scores +1 for matching joinUrl', () => {
    const briefing = { upcomingMeeting: { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' } };
    const meeting = { joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc' };
    const { score } = ctx.briefingAlignmentScore(briefing, meeting);
    assert.ok(score >= 1);
  });

  it('counts compared signals accurately', () => {
    const briefing = {
      meetingId: 'mtg1',
      upcomingMeeting: {
        title: 'Sprint',
        startAt: '2025-06-15T10:00:00Z',
        organizer: 'Alice',
        joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
      },
    };
    const meeting = {
      id: 'mtg1',
      title: 'Sprint',
      startAt: '2025-06-15T10:00:00Z',
      organizer: 'Alice',
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
    };
    const { comparedSignals } = ctx.briefingAlignmentScore(briefing, meeting);
    assert.equal(comparedSignals, 5); // id + title + startAt + organizer + joinUrl
  });
});

/* ================================================================== */
/*  isBriefingAlignedWithMeeting                                      */
/* ================================================================== */
describe('isBriefingAlignedWithMeeting()', () => {
  it('returns true when score > 0 and signals compared', () => {
    const briefing = { meetingId: 'mtg1', upcomingMeeting: {} };
    const meeting = { id: 'mtg1' };
    assert.equal(ctx.isBriefingAlignedWithMeeting(briefing, meeting), true);
  });

  it('returns false when titles mismatch and nothing else matches', () => {
    const briefing = { upcomingMeeting: { title: 'A' } };
    const meeting = { title: 'B' };
    assert.equal(ctx.isBriefingAlignedWithMeeting(briefing, meeting), false);
  });

  it('returns false when no signals to compare', () => {
    const briefing = { upcomingMeeting: {} };
    const meeting = {};
    assert.equal(ctx.isBriefingAlignedWithMeeting(briefing, meeting), false);
  });
});

/* ================================================================== */
/*  classifyBriefingSeverity                                          */
/* ================================================================== */
describe('classifyBriefingSeverity()', () => {
  it('returns "briefed" when briefing exists', () => {
    assert.equal(ctx.classifyBriefingSeverity({}, { headline: 'test' }), 'briefed');
  });

  it('returns "unbriefed" when briefing is null', () => {
    assert.equal(ctx.classifyBriefingSeverity({}, null), 'unbriefed');
  });

  it('returns "unbriefed" when briefing is undefined', () => {
    assert.equal(ctx.classifyBriefingSeverity({}, undefined), 'unbriefed');
  });
});

/* ================================================================== */
/*  meetingIdentitySeed                                               */
/* ================================================================== */
describe('meetingIdentitySeed()', () => {
  it('returns pipe-delimited lowercase string', () => {
    const seed = ctx.meetingIdentitySeed({
      title: 'Sprint Planning',
      organizer: 'Alice',
      startAt: '2025-06-15T10:00:00Z',
      endAt: '2025-06-15T11:00:00Z',
      joinUrl: 'https://teams.microsoft.com/l/meetup-join/abc',
    });
    assert.ok(seed.includes('|'));
    assert.equal(seed, seed.toLowerCase());
  });

  it('is deterministic', () => {
    const item = { title: 'A', organizer: 'B' };
    assert.equal(ctx.meetingIdentitySeed(item), ctx.meetingIdentitySeed(item));
  });

  it('handles empty input', () => {
    const seed = ctx.meetingIdentitySeed({});
    assert.equal(seed, '||||');
  });
});

/* ================================================================== */
/*  resolveMeetingId                                                  */
/* ================================================================== */
describe('resolveMeetingId()', () => {
  it('returns raw id when present', () => {
    assert.equal(ctx.resolveMeetingId({ id: 'mtg_123' }), 'mtg_123');
  });

  it('generates meeting_ prefixed id from identity seed', () => {
    const id = ctx.resolveMeetingId({ title: 'Sprint Review', organizer: 'Bob' });
    assert.ok(id.startsWith('meeting_'));
  });

  it('is deterministic', () => {
    const item = { title: 'Same', organizer: 'Same' };
    assert.equal(ctx.resolveMeetingId(item), ctx.resolveMeetingId(item));
  });
});

/* ================================================================== */
/*  buildFallbackBriefingSources                                      */
/* ================================================================== */
describe('buildFallbackBriefingSources()', () => {
  it('extracts URLs from payload fields', () => {
    const sources = ctx.buildFallbackBriefingSources({
      headline: 'See https://example.com/doc for details',
      keyUpdates: ['Update at https://contoso.sharepoint.com/sites/team/doc.docx'],
    });
    assert.ok(sources.length >= 1);
    assert.ok(sources[0].url);
    assert.ok(sources[0].label);
  });

  it('returns empty for payload with no URLs', () => {
    const sources = ctx.buildFallbackBriefingSources({ headline: 'No links here' });
    assert.equal(sources.length, 0);
  });

  it('limits to 8 sources', () => {
    const urls = Array.from({ length: 20 }, (_, i) => `https://example.com/page${i}`);
    const sources = ctx.buildFallbackBriefingSources({ keyUpdates: urls });
    assert.ok(sources.length <= 8);
  });
});

/* ================================================================== */
/*  isBriefingUnseen                                                  */
/* ================================================================== */
describe('isBriefingUnseen()', () => {
  it('returns true when no seenAt recorded', () => {
    ctx.state.briefingSeenAt = {};
    assert.equal(ctx.isBriefingUnseen('mtg1', { generatedAt: '2025-06-15T10:00:00Z' }), true);
  });

  it('returns false when seenAt >= generatedAt', () => {
    ctx.state.briefingSeenAt = { mtg1: '2025-06-15T12:00:00Z' };
    assert.equal(ctx.isBriefingUnseen('mtg1', { generatedAt: '2025-06-15T10:00:00Z' }), false);
  });

  it('returns true when seenAt < generatedAt', () => {
    ctx.state.briefingSeenAt = { mtg1: '2025-06-15T08:00:00Z' };
    assert.equal(ctx.isBriefingUnseen('mtg1', { generatedAt: '2025-06-15T10:00:00Z' }), true);
  });

  it('returns false for null briefing', () => {
    assert.equal(ctx.isBriefingUnseen('mtg1', null), false);
  });
});
