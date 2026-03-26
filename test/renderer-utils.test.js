'use strict';

const { describe, it, before } = require('node:test');
const assert = require('node:assert/strict');
const looseAssert = require('node:assert');
const { createRendererContext, loadFile } = require('./helpers/renderer-context');

let ctx;

before(() => {
  ctx = createRendererContext();
  loadFile(ctx, 'renderer/utils.js');
});

/* ================================================================== */
/*  escapeHtml                                                        */
/* ================================================================== */
describe('escapeHtml()', () => {
  it('escapes &, <, >, ", \'', () => {
    assert.equal(ctx.escapeHtml('&<>"\''), '&amp;&lt;&gt;&quot;&#39;');
  });

  it('passes through plain text unchanged', () => {
    assert.equal(ctx.escapeHtml('hello world'), 'hello world');
  });

  it('coerces non-string to string', () => {
    assert.equal(ctx.escapeHtml(42), '42');
    assert.equal(ctx.escapeHtml(null), 'null');
  });
});

/* ================================================================== */
/*  normalizeExternalUrl                                              */
/* ================================================================== */
describe('normalizeExternalUrl()', () => {
  it('returns null for falsy values', () => {
    assert.equal(ctx.normalizeExternalUrl(null), null);
    assert.equal(ctx.normalizeExternalUrl(''), null);
    assert.equal(ctx.normalizeExternalUrl(undefined), null);
  });

  it('normalizes a simple https URL', () => {
    assert.equal(ctx.normalizeExternalUrl('https://example.com'), 'https://example.com/');
  });

  it('decodes &amp; entities', () => {
    assert.equal(
      ctx.normalizeExternalUrl('https://example.com?a=1&amp;b=2'),
      'https://example.com/?a=1&b=2'
    );
  });

  it('strips surrounding quotes and brackets', () => {
    assert.equal(ctx.normalizeExternalUrl('"https://example.com"'), 'https://example.com/');
    assert.equal(ctx.normalizeExternalUrl('<https://example.com>'), 'https://example.com/');
  });

  it('prepends https:// for bare domain paths', () => {
    assert.equal(ctx.normalizeExternalUrl('example.com/path'), 'https://example.com/path');
  });

  it('returns null for non-http protocols', () => {
    assert.equal(ctx.normalizeExternalUrl('ftp://example.com'), null);
  });

  it('returns null for garbage strings', () => {
    assert.equal(ctx.normalizeExternalUrl('not a url'), null);
  });

  it('strips whitespace and newlines', () => {
    const url = '  https://example.com/path  \n ';
    assert.equal(ctx.normalizeExternalUrl(url), 'https://example.com/path');
  });
});

/* ================================================================== */
/*  isGenericUrl                                                      */
/* ================================================================== */
describe('isGenericUrl()', () => {
  it('returns true for falsy input', () => {
    assert.equal(ctx.isGenericUrl(null), true);
    assert.equal(ctx.isGenericUrl(''), true);
  });

  it('identifies generic Outlook calendar URL', () => {
    assert.equal(ctx.isGenericUrl('https://outlook.office.com/calendar'), true);
    assert.equal(ctx.isGenericUrl('https://outlook.office.com/calendar/'), true);
  });

  it('identifies generic Teams URL', () => {
    assert.equal(ctx.isGenericUrl('https://teams.microsoft.com/'), true);
  });

  it('returns false for a specific URL', () => {
    assert.equal(ctx.isGenericUrl('https://outlook.office.com/mail/inbox/id/AAMk123'), false);
  });

  it('identifies generic SharePoint root', () => {
    assert.equal(ctx.isGenericUrl('https://contoso.sharepoint.com/'), true);
  });

  it('treats SharePoint site root as generic', () => {
    assert.equal(ctx.isGenericUrl('https://microsoft-my.sharepoint.com/teams/SomeSite/'), true);
  });

  it('treats SharePoint with document path as NOT generic', () => {
    assert.equal(ctx.isGenericUrl('https://microsoft-my.sharepoint.com/teams/SomeSite/Shared%20Documents/report.xlsx'), false);
  });

  it('treats OneDrive personal root as generic', () => {
    assert.equal(ctx.isGenericUrl('https://contoso-my.sharepoint.com/personal/user_contoso_com/'), true);
  });

  it('treats Outlook empty message ID as generic', () => {
    assert.equal(ctx.isGenericUrl('https://outlook.office.com/mail/inbox/id/'), true);
  });

  it('treats Outlook with real message ID as NOT generic', () => {
    assert.equal(ctx.isGenericUrl('https://outlook.office.com/mail/inbox/id/AAMkAGQ3'), false);
  });

  it('treats Teams container-level path as generic', () => {
    assert.equal(ctx.isGenericUrl('https://teams.microsoft.com/l/message/'), true);
  });

  it('treats URL with truncation ellipsis as generic', () => {
    assert.equal(ctx.isGenericUrl('https://sharepoint.com/sites/team/....'), true);
  });
});

/* ================================================================== */
/*  isHallucinatedUrl                                                 */
/* ================================================================== */
describe('isHallucinatedUrl()', () => {
  it('returns true for falsy input', () => {
    assert.equal(ctx.isHallucinatedUrl(null), true);
  });

  it('detects turn1search pattern', () => {
    assert.equal(ctx.isHallucinatedUrl('https://example.com/turn1search3'), true);
  });

  it('detects dummy GUID', () => {
    assert.equal(ctx.isHallucinatedUrl('https://outlook.office.com/00000000-0000-0000-0000-000000000000'), true);
  });

  it('detects placeholder keyword', () => {
    assert.equal(ctx.isHallucinatedUrl('https://teams.microsoft.com/placeholder'), true);
  });

  it('returns false for a clean URL', () => {
    assert.equal(ctx.isHallucinatedUrl('https://outlook.office.com/mail/inbox/id/real123'), false);
  });
});

/* ================================================================== */
/*  isDeepLink                                                        */
/* ================================================================== */
describe('isDeepLink()', () => {
  it('returns false for falsy input', () => {
    assert.equal(ctx.isDeepLink(null), false);
    assert.equal(ctx.isDeepLink(''), false);
  });

  it('returns false for undefined', () => {
    assert.equal(ctx.isDeepLink(undefined), false);
  });

  it('recognizes Outlook mail deep link', () => {
    assert.equal(ctx.isDeepLink('https://outlook.office.com/mail/inbox/id/AAMk123'), true);
  });

  it('recognizes Teams meeting link', () => {
    assert.equal(ctx.isDeepLink('https://teams.microsoft.com/l/meetup-join/abc'), true);
  });

  it('recognizes SharePoint document link', () => {
    assert.equal(ctx.isDeepLink('https://contoso.sharepoint.com/sites/team/:w:/Doc.aspx'), true);
  });

  it('returns false for generic URL', () => {
    assert.equal(ctx.isDeepLink('https://www.google.com/'), false);
  });

  // ── Relaxed deep-link matching (any HTTPS with non-trivial path) ──

  it('accepts Power BI deep link', () => {
    assert.equal(ctx.isDeepLink('https://app.powerbi.com/groups/abc123/reports/def456'), true);
  });

  it('accepts Viva Engage / Yammer deep link', () => {
    assert.equal(ctx.isDeepLink('https://engage.cloud.microsoft/main/threads/123456'), true);
  });

  it('accepts Forms deep link', () => {
    assert.equal(ctx.isDeepLink('https://forms.office.com/Pages/ResponsePage.aspx?id=abc123'), true);
  });

  it('accepts custom internal site deep link', () => {
    assert.equal(ctx.isDeepLink('https://myapp.contoso.com/dashboard/report/42'), true);
  });

  it('rejects plain domain root with trailing slash', () => {
    assert.equal(ctx.isDeepLink('https://example.com/'), false);
  });

  it('rejects plain domain root without trailing slash', () => {
    assert.equal(ctx.isDeepLink('https://example.com'), false);
  });

  it('rejects HTTP (non-HTTPS) URL even with path', () => {
    assert.equal(ctx.isDeepLink('http://outlook.office.com/mail/inbox/id/AAMk123'), false);
  });
});

/* ================================================================== */
/*  normalizeSignalType                                               */
/* ================================================================== */
describe('normalizeSignalType()', () => {
  it('maps common source labels to canonical signal types', () => {
    assert.equal(ctx.normalizeSignalType('Email'), 'email');
    assert.equal(ctx.normalizeSignalType('Teams chat'), 'chat');
    assert.equal(ctx.normalizeSignalType('Calendar event'), 'meeting');
    assert.equal(ctx.normalizeSignalType('Document'), 'doc');
  });

  it('returns source for unknown values', () => {
    assert.equal(ctx.normalizeSignalType('random'), 'source');
    assert.equal(ctx.normalizeSignalType(null), 'source');
  });
});

/* ================================================================== */
/*  isSignalTypeDeepLink                                              */
/* ================================================================== */
describe('isSignalTypeDeepLink()', () => {
  it('accepts matching links for email/chat/doc signal types', () => {
    assert.equal(ctx.isSignalTypeDeepLink('email', 'https://outlook.office.com/mail/inbox/id/AAMk123'), true);
    assert.equal(ctx.isSignalTypeDeepLink('chat', 'https://teams.microsoft.com/l/message/19:abc'), true);
    assert.equal(ctx.isSignalTypeDeepLink('doc', 'https://contoso.sharepoint.com/sites/team/:w:/Doc.aspx'), true);
  });

  it('rejects non-matching links for typed signals', () => {
    assert.equal(ctx.isSignalTypeDeepLink('email', 'https://contoso.com/path/to/resource'), false);
    assert.equal(ctx.isSignalTypeDeepLink('chat', 'https://outlook.office.com/mail/inbox/id/AAMk123'), false);
  });
});

/* ================================================================== */
/*  hashString                                                        */
/* ================================================================== */
describe('hashString()', () => {
  it('returns an 8-char hex string', () => {
    const result = ctx.hashString('hello');
    assert.match(result, /^[0-9a-f]{8}$/);
  });

  it('is deterministic', () => {
    assert.equal(ctx.hashString('test'), ctx.hashString('test'));
  });

  it('produces different hashes for different inputs', () => {
    assert.notEqual(ctx.hashString('aaa'), ctx.hashString('bbb'));
  });

  it('handles empty/falsy input', () => {
    const result = ctx.hashString('');
    assert.match(result, /^[0-9a-f]{8}$/);
    assert.equal(ctx.hashString(null), ctx.hashString(''));
  });
});

/* ================================================================== */
/*  safeDate                                                          */
/* ================================================================== */
describe('safeDate()', () => {
  it('returns fallback for falsy input', () => {
    assert.equal(ctx.safeDate(null), 'No due date');
    assert.equal(ctx.safeDate(''), 'No due date');
  });

  it('returns custom fallback when provided', () => {
    assert.equal(ctx.safeDate(null, 'N/A'), 'N/A');
  });

  it('returns locale string for valid ISO date', () => {
    const result = ctx.safeDate('2025-06-15T10:00:00Z');
    assert.ok(result.length > 0);
    assert.notEqual(result, 'No due date');
  });

  it('returns fallback for invalid date string', () => {
    assert.equal(ctx.safeDate('not-a-date'), 'No due date');
  });
});

/* ================================================================== */
/*  relativeTime                                                      */
/* ================================================================== */
describe('relativeTime()', () => {
  it('returns null for falsy input', () => {
    assert.equal(ctx.relativeTime(null), null);
    assert.equal(ctx.relativeTime(''), null);
  });

  it('returns null for invalid date', () => {
    assert.equal(ctx.relativeTime('garbage'), null);
  });

  it('returns "just now" for a future date', () => {
    const future = new Date(Date.now() + 60_000).toISOString();
    assert.equal(ctx.relativeTime(future), 'just now');
  });

  it('returns "just now" for less than 60 seconds ago', () => {
    const recent = new Date(Date.now() - 30_000).toISOString();
    assert.equal(ctx.relativeTime(recent), 'just now');
  });

  it('returns minutes for 1-59 min ago', () => {
    const fiveMinAgo = new Date(Date.now() - 5 * 60_000).toISOString();
    assert.match(ctx.relativeTime(fiveMinAgo), /^\d+m ago$/);
  });

  it('returns hours for 1-23 hr ago', () => {
    const threeHrsAgo = new Date(Date.now() - 3 * 3_600_000).toISOString();
    assert.match(ctx.relativeTime(threeHrsAgo), /^\d+h ago$/);
  });

  it('returns days for 24+ hr ago', () => {
    const twoDaysAgo = new Date(Date.now() - 2 * 86_400_000).toISOString();
    assert.match(ctx.relativeTime(twoDaysAgo), /^\d+d ago$/);
  });
});

/* ================================================================== */
/*  normalizeSpacingArtifacts                                         */
/* ================================================================== */
describe('normalizeSpacingArtifacts()', () => {
  it('fixes Teamschat → Teams chat', () => {
    assert.equal(ctx.normalizeSpacingArtifacts('Teamschat'), 'Teams chat');
  });

  it('inserts space between camelCase', () => {
    assert.equal(ctx.normalizeSpacingArtifacts('nextSteps'), 'next Steps');
  });

  it('inserts space between letters and digits', () => {
    assert.equal(ctx.normalizeSpacingArtifacts('item3'), 'item 3');
    assert.equal(ctx.normalizeSpacingArtifacts('3items'), '3 items');
  });

  it('collapses multiple spaces', () => {
    assert.equal(ctx.normalizeSpacingArtifacts('hello   world'), 'hello world');
  });

  it('handles falsy input', () => {
    assert.equal(ctx.normalizeSpacingArtifacts(null), '');
    assert.equal(ctx.normalizeSpacingArtifacts(''), '');
  });
});

/* ================================================================== */
/*  cleanDisplayText                                                  */
/* ================================================================== */
describe('cleanDisplayText()', () => {
  it('strips markdown links, keeping label', () => {
    assert.ok(ctx.cleanDisplayText('See [docs](https://example.com/docs) here').includes('docs'));
    assert.ok(!ctx.cleanDisplayText('See [docs](https://example.com/docs) here').includes('https://'));
  });

  it('strips footnote references', () => {
    const result = ctx.cleanDisplayText('Important update [1] with details [2]');
    assert.ok(!result.includes('[1]'));
    assert.ok(!result.includes('[2]'));
  });

  it('strips bare URLs', () => {
    const result = ctx.cleanDisplayText('Visit https://example.com/page for info');
    assert.ok(!result.includes('https://'));
  });

  it('strips bold markers', () => {
    const result = ctx.cleanDisplayText('This is **bold** text');
    assert.ok(!result.includes('**'));
    assert.ok(result.includes('bold'));
  });

  it('handles falsy input', () => {
    assert.equal(ctx.cleanDisplayText(null), '');
    assert.equal(ctx.cleanDisplayText(''), '');
  });
});

/* ================================================================== */
/*  sanitizeBriefingText                                              */
/* ================================================================== */
describe('sanitizeBriefingText()', () => {
  it('strips markdown links', () => {
    const result = ctx.sanitizeBriefingText('Read [this](https://example.com)');
    assert.ok(result.includes('this'));
    assert.ok(!result.includes('https://'));
  });

  it('strips bold markers', () => {
    const result = ctx.sanitizeBriefingText('**Important** update');
    assert.ok(!result.includes('**'));
  });

  it('strips footnote references', () => {
    const result = ctx.sanitizeBriefingText('Key finding [1]');
    assert.ok(!result.includes('[1]'));
  });

  it('handles falsy input', () => {
    assert.equal(ctx.sanitizeBriefingText(null), '');
    assert.equal(ctx.sanitizeBriefingText(''), '');
  });
});

/* ================================================================== */
/*  compactLinkLabel                                                  */
/* ================================================================== */
describe('compactLinkLabel()', () => {
  it('returns host for a valid URL', () => {
    assert.equal(ctx.compactLinkLabel('https://outlook.office.com/mail/id/123'), 'outlook.office.com');
  });

  it('strips www. prefix', () => {
    assert.equal(ctx.compactLinkLabel('https://www.example.com/page'), 'example.com');
  });

  it('truncates long hostnames', () => {
    const longDomain = 'https://this-is-a-very-long-subdomain.example.co.uk/path';
    const label = ctx.compactLinkLabel(longDomain);
    assert.ok(label.length <= 28);
  });

  it('returns fallback for invalid URL', () => {
    assert.equal(ctx.compactLinkLabel('not-a-url'), 'source');
    assert.equal(ctx.compactLinkLabel('not-a-url', 'custom'), 'custom');
  });
});

/* ================================================================== */
/*  normalizeSeverity                                                 */
/* ================================================================== */
describe('normalizeSeverity()', () => {
  it('maps critical variants', () => {
    assert.equal(ctx.normalizeSeverity('Critical'), 'Critical');
    assert.equal(ctx.normalizeSeverity('CRITICAL'), 'Critical');
    assert.equal(ctx.normalizeSeverity('critical issue'), 'Critical');
  });

  it('maps elevated variants', () => {
    assert.equal(ctx.normalizeSeverity('Elevated'), 'Elevated');
    assert.equal(ctx.normalizeSeverity('ELEVATED'), 'Elevated');
  });

  it('defaults to Observe', () => {
    assert.equal(ctx.normalizeSeverity('low'), 'Observe');
    assert.equal(ctx.normalizeSeverity(''), 'Observe');
    assert.equal(ctx.normalizeSeverity(null), 'Observe');
  });
});

/* ================================================================== */
/*  extractExternalUrls                                               */
/* ================================================================== */
describe('extractExternalUrls()', () => {
  it('extracts URLs from markdown links', () => {
    const urls = ctx.extractExternalUrls('See [docs](https://example.com/docs)');
    assert.ok(urls.length >= 1);
    assert.ok(urls[0].startsWith('https://example.com'));
  });

  it('extracts bare URLs', () => {
    const urls = ctx.extractExternalUrls('Visit https://example.com/page');
    assert.ok(urls.length >= 1);
  });

  it('deduplicates URLs', () => {
    const urls = ctx.extractExternalUrls('[a](https://example.com) and https://example.com');
    const unique = new Set(urls);
    assert.equal(urls.length, unique.size);
  });

  it('returns empty array for falsy input', () => {
    assert.equal(ctx.extractExternalUrls(null).length, 0);
    assert.equal(ctx.extractExternalUrls('').length, 0);
  });
});

/* ================================================================== */
/*  toIsoOrNull                                                       */
/* ================================================================== */
describe('toIsoOrNull()', () => {
  it('returns ISO string for valid date', () => {
    const result = ctx.toIsoOrNull('2025-06-15T10:00:00Z');
    assert.match(result, /^\d{4}-\d{2}-\d{2}T/);
  });

  it('returns null for falsy input', () => {
    assert.equal(ctx.toIsoOrNull(null), null);
    assert.equal(ctx.toIsoOrNull(''), null);
  });

  it('returns null for invalid date', () => {
    assert.equal(ctx.toIsoOrNull('not-a-date'), null);
  });
});

/* ================================================================== */
/*  normalizeEvidenceLink                                             */
/* ================================================================== */
describe('normalizeEvidenceLink()', () => {
  it('normalizes typed links and preserves signalAt when valid', () => {
    const link = ctx.normalizeEvidenceLink({
      type: 'email',
      label: 'Status email',
      url: 'https://outlook.office.com/mail/inbox/id/AAMk123',
      signalAt: '2026-03-04T10:00:00-05:00',
    }, 'email');
    assert.equal(link.type, 'email');
    assert.equal(link.url, 'https://outlook.office.com/mail/inbox/id/AAMk123');
    assert.equal(link.signalAt, '2026-03-04T15:00:00.000Z');
  });

  it('drops links that do not match the expected signal type', () => {
    const link = ctx.normalizeEvidenceLink({
      type: 'chat',
      url: 'https://outlook.office.com/mail/inbox/id/AAMk123',
    }, 'chat');
    assert.equal(link, null);
  });
});

/* ================================================================== */
/*  signalRecencyLabel                                                */
/* ================================================================== */
describe('signalRecencyLabel()', () => {
  it('returns today/yesterday for very recent signals', () => {
    const reference = new Date('2026-03-10T12:00:00Z');
    assert.equal(ctx.signalRecencyLabel('2026-03-10T08:00:00Z', reference), 'today');
    assert.equal(ctx.signalRecencyLabel('2026-03-09T08:00:00Z', reference), 'yesterday');
  });

  it('returns short date for older signals in the same year', () => {
    const reference = new Date('2026-03-10T12:00:00Z');
    assert.equal(ctx.signalRecencyLabel('2026-03-07T08:00:00Z', reference), 'Mar 7');
    assert.equal(ctx.signalRecencyLabel('2026-03-02T08:00:00Z', reference), 'Mar 2');
    assert.equal(ctx.signalRecencyLabel('2026-02-20T08:00:00Z', reference), 'Feb 20');
  });

  it('includes year for signals from a different year', () => {
    const reference = new Date('2026-03-10T12:00:00Z');
    assert.equal(ctx.signalRecencyLabel('2025-12-15T08:00:00Z', reference), 'Dec 15, 2025');
  });
});

/* ================================================================== */
/*  nowIso                                                            */
/* ================================================================== */
describe('nowIso()', () => {
  it('returns an ISO 8601 timestamp', () => {
    assert.match(ctx.nowIso(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

/* ================================================================== */
/*  extractInlineCitations                                            */
/* ================================================================== */
describe('extractInlineCitations()', () => {
  it('returns empty array for null/undefined/empty', () => {
    looseAssert.deepEqual(ctx.extractInlineCitations(null), []);
    looseAssert.deepEqual(ctx.extractInlineCitations(undefined), []);
    looseAssert.deepEqual(ctx.extractInlineCitations(''), []);
  });

  it('extracts numeric footnote citation with domain label', () => {
    const text = 'Meeting notes [1](https://contoso.sharepoint.com/teams/ProjectAlpha/_layouts/15/Doc.aspx?action=edit)';
    const result = ctx.extractInlineCitations(text);
    assert.equal(result.length, 1);
    // Numeric labels are replaced with domain-based compact labels
    assert.equal(result[0].label, 'contoso.sharepoint.com');
    assert.equal(result[0].type, 'doc');
    assert.ok(result[0].url.includes('sharepoint.com'));
  });

  it('extracts descriptive label citation', () => {
    const text = 'See the [status report](https://loop.microsoft.com/p/eyJ1IjoiaHR0cHM)';
    const result = ctx.extractInlineCitations(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].label, 'status report');
    assert.equal(result[0].type, 'doc');
    assert.ok(result[0].url.includes('loop.microsoft.com'));
  });

  it('extracts multiple citations from one text', () => {
    const text = 'See [1](https://outlook.office.com/mail/inbox/id/AAMk123) and [2](https://teams.microsoft.com/l/message/19:abc123)';
    const result = ctx.extractInlineCitations(text);
    assert.equal(result.length, 2);
    const emailLink = result.find((r) => r.url.includes('outlook.office.com'));
    const chatLink = result.find((r) => r.url.includes('teams.microsoft.com'));
    assert.ok(emailLink, 'should have email link');
    assert.ok(chatLink, 'should have chat link');
  });

  it('deduplicates by URL (first match wins)', () => {
    const url = 'https://outlook.office.com/mail/inbox/id/AAMk123';
    const text = `See [email thread](${url}) and [important email](${url})`;
    const result = ctx.extractInlineCitations(text);
    assert.equal(result.length, 1);
    assert.equal(result[0].label, 'email thread');
  });

  it('skips non-https URLs', () => {
    // http:// passes normalizeExternalUrl but isDeepLink rejects non-HTTPS
    // ftp:// is rejected outright by normalizeExternalUrl
    const text = '[link](http://outlook.office.com/mail/inbox/id/AAMk123) and [doc](ftp://files.contoso.com/report.pdf)';
    const result = ctx.extractInlineCitations(text);
    assert.equal(result.length, 0);
  });

  it('skips generic URLs', () => {
    const text = '[calendar](https://outlook.office.com/calendar) and [teams](https://teams.microsoft.com/)';
    const result = ctx.extractInlineCitations(text);
    assert.equal(result.length, 0);
  });

  it('skips hallucinated URLs', () => {
    const text = '[ref](https://outlook.office.com/mail/turn1search3) and [fake](https://teams.microsoft.com/placeholder/abc)';
    const result = ctx.extractInlineCitations(text);
    assert.equal(result.length, 0);
  });

  it('infers signal type from URL', () => {
    const spUrl = 'https://microsoft.sharepoint.com/sites/team/_layouts/15/Doc.aspx';
    const meetUrl = 'https://teams.microsoft.com/l/meetup-join/abc123';
    const mailUrl = 'https://outlook.office.com/mail/inbox/id/AAMk123';
    const chatUrl = 'https://teams.microsoft.com/l/message/19:abc123';
    const text = `Doc [1](${spUrl}) meeting [2](${meetUrl}) email [3](${mailUrl}) chat [4](${chatUrl})`;
    const result = ctx.extractInlineCitations(text);
    assert.equal(result.length, 4);

    const doc = result.find((r) => r.url.includes('sharepoint.com'));
    const meet = result.find((r) => r.url.includes('meetup-join'));
    const mail = result.find((r) => r.url.includes('outlook.office.com'));
    const chat = result.find((r) => r.url.includes('message/19'));
    assert.equal(doc.type, 'doc');
    assert.equal(meet.type, 'meeting');
    assert.equal(mail.type, 'email');
    assert.equal(chat.type, 'chat');
  });

  it('returns empty array for plain text with no citations', () => {
    const text = 'This is plain text without any markdown links or citations.';
    const result = ctx.extractInlineCitations(text);
    looseAssert.deepEqual(result, []);
    // Strings are immutable in JS — the function only extracts, never modifies input
  });

  it('handles URLs with special characters', () => {
    const url = 'https://microsoft.sharepoint.com/sites/team/_layouts/15/Doc.aspx?sourcedoc=%7BABCD-1234%7D&action=edit';
    const text = `Updated doc [report](${url})`;
    const result = ctx.extractInlineCitations(text);
    assert.equal(result.length, 1);
    assert.ok(result[0].url.includes('sharepoint.com'));
    assert.equal(result[0].type, 'doc');
    assert.equal(result[0].label, 'report');
  });
});

/* ================================================================== */
/*  extractBareUrlCitations                                           */
/* ================================================================== */
describe('extractBareUrlCitations()', () => {
  it('returns empty array for null/undefined/empty', () => {
    looseAssert.deepEqual(ctx.extractBareUrlCitations(null), []);
    looseAssert.deepEqual(ctx.extractBareUrlCitations(undefined), []);
    looseAssert.deepEqual(ctx.extractBareUrlCitations(''), []);
  });

  it('extracts a bare deep URL from text', () => {
    const text = 'Check https://outlook.office.com/mail/inbox/id/AAMkAGQ3ZDIwNTkx for details';
    const result = ctx.extractBareUrlCitations(text);
    assert.equal(result.length, 1);
    assert.ok(result[0].url.includes('outlook.office.com'));
    assert.equal(result[0].type, 'email');
    assert.equal(result[0].label, 'outlook.office.com');
  });

  it('skips URLs inside markdown links', () => {
    const text = 'See [Email](https://outlook.office.com/mail/inbox/id/AAMkAGQ3ZDIwNTkx)';
    const result = ctx.extractBareUrlCitations(text);
    assert.equal(result.length, 0);
  });

  it('extracts bare URLs but NOT markdown URLs from mixed text', () => {
    const bareUrl = 'https://outlook.office.com/mail/inbox/id/AAMkBareUrl123';
    const mdUrl = 'https://teams.microsoft.com/l/message/19:abc123';
    const text = `Check ${bareUrl} and see [chat](${mdUrl}) for context`;
    const result = ctx.extractBareUrlCitations(text);
    assert.equal(result.length, 1);
    assert.ok(result[0].url.includes('AAMkBareUrl123'));
  });

  it('skips generic/truncated URLs', () => {
    const text = 'Go to https://microsoft-my.sharepoint.com/teams/ for the files';
    const result = ctx.extractBareUrlCitations(text);
    assert.equal(result.length, 0);
  });

  it('skips hallucinated URLs', () => {
    const text = 'Reference https://outlook.office.com/mail/turn1search3 for info';
    const result = ctx.extractBareUrlCitations(text);
    assert.equal(result.length, 0);
  });

  it('deduplicates by URL', () => {
    const url = 'https://outlook.office.com/mail/inbox/id/AAMkDuplicate456';
    const text = `First ${url} and again ${url}`;
    const result = ctx.extractBareUrlCitations(text);
    assert.equal(result.length, 1);
  });

  it('infers type from URL', () => {
    const emailUrl = 'https://outlook.office.com/mail/inbox/id/AAMkInfer789';
    const docUrl = 'https://microsoft.sharepoint.com/sites/team/_layouts/15/Doc.aspx?id=report';
    const text = `Email ${emailUrl} and doc ${docUrl}`;
    const result = ctx.extractBareUrlCitations(text);
    assert.equal(result.length, 2);
    const email = result.find((r) => r.url.includes('outlook.office.com'));
    const doc = result.find((r) => r.url.includes('sharepoint.com'));
    assert.equal(email.type, 'email');
    assert.equal(doc.type, 'doc');
  });
});

describe('adoptStructuredLabels()', () => {
  it('returns inlineLinks unchanged when structuredLinks is empty', () => {
    const inline = [{ label: 'teams.microsoft.com', type: 'chat', url: 'https://teams.microsoft.com/l/message/19:abc/123' }];
    const result = ctx.adoptStructuredLabels(inline, []);
    assert.equal(result[0].label, 'teams.microsoft.com');
  });

  it('returns inlineLinks unchanged when structuredLinks is null', () => {
    const inline = [{ label: 'teams.microsoft.com', type: 'chat', url: 'https://teams.microsoft.com/l/message/19:abc/123' }];
    const result = ctx.adoptStructuredLabels(inline, null);
    assert.equal(result[0].label, 'teams.microsoft.com');
  });

  it('adopts descriptive label from structured link matching by type', () => {
    const inline = [{ label: 'teams.microsoft.com', type: 'chat', url: 'https://teams.microsoft.com/l/message/19:abc/123' }];
    const structured = [{ label: 'Weekly sync message on datacenter migration', type: 'chat', url: 'https://teams.microsoft.com' }];
    const result = ctx.adoptStructuredLabels(inline, structured);
    assert.equal(result[0].label, 'Weekly sync message on datacenter migration');
    assert.equal(result[0].url, 'https://teams.microsoft.com/l/message/19:abc/123');
  });

  it('adopts signalAt from structured link when inline has none', () => {
    const inline = [{ label: 'outlook.office365.com', type: 'email', url: 'https://outlook.office365.com/owa/?ItemID=AAMk123' }];
    const structured = [{ label: 'Sentinel POC email', type: 'email', url: 'https://outlook.office.com', signalAt: '2026-03-05T09:00:00Z' }];
    const result = ctx.adoptStructuredLabels(inline, structured);
    assert.equal(result[0].label, 'Sentinel POC email');
    assert.equal(result[0].signalAt, '2026-03-05T09:00:00Z');
  });

  it('does not overwrite existing signalAt on inline link', () => {
    const inline = [{ label: 'outlook.office365.com', type: 'email', url: 'https://outlook.office365.com/owa/?ItemID=AAMk123', signalAt: '2026-03-04T00:00:00Z' }];
    const structured = [{ label: 'Email thread', type: 'email', url: 'https://outlook.office.com', signalAt: '2026-03-05T09:00:00Z' }];
    const result = ctx.adoptStructuredLabels(inline, structured);
    assert.equal(result[0].signalAt, '2026-03-04T00:00:00Z');
  });

  it('skips structured links with numeric-only labels', () => {
    const inline = [{ label: 'teams.microsoft.com', type: 'chat', url: 'https://teams.microsoft.com/l/message/19:abc/123' }];
    const structured = [{ label: '1', type: 'chat', url: 'https://teams.microsoft.com' }];
    const result = ctx.adoptStructuredLabels(inline, structured);
    assert.equal(result[0].label, 'teams.microsoft.com');
  });

  it('matches multiple inline links to multiple structured by type', () => {
    const inline = [
      { label: 'teams.microsoft.com', type: 'chat', url: 'https://teams.microsoft.com/l/message/19:abc/1' },
      { label: 'teams.microsoft.com', type: 'chat', url: 'https://teams.microsoft.com/l/message/19:def/2' },
    ];
    const structured = [
      { label: 'Datacenter migration thread', type: 'chat', url: 'https://teams.microsoft.com' },
      { label: 'CAF scope review thread', type: 'chat', url: 'https://teams.microsoft.com' },
    ];
    const result = ctx.adoptStructuredLabels(inline, structured);
    assert.equal(result[0].label, 'Datacenter migration thread');
    assert.equal(result[1].label, 'CAF scope review thread');
  });

  it('consumes each structured label at most once and numbers overflow', () => {
    const inline = [
      { label: 'teams.microsoft.com', type: 'chat', url: 'https://teams.microsoft.com/l/message/19:abc/1' },
      { label: 'teams.microsoft.com', type: 'chat', url: 'https://teams.microsoft.com/l/message/19:def/2' },
    ];
    const structured = [
      { label: 'Only one label', type: 'chat', url: 'https://teams.microsoft.com' },
    ];
    const result = ctx.adoptStructuredLabels(inline, structured);
    assert.equal(result[0].label, 'Only one label');
    assert.equal(result[1].label, 'Only one label (2)');
  });

  it('numbers overflow sequentially for 3+ inline citations', () => {
    const inline = [
      { label: 'teams.microsoft.com', type: 'chat', url: 'https://teams.microsoft.com/l/message/19:abc/1' },
      { label: 'teams.microsoft.com', type: 'chat', url: 'https://teams.microsoft.com/l/message/19:def/2' },
      { label: 'teams.microsoft.com', type: 'chat', url: 'https://teams.microsoft.com/l/message/19:ghi/3' },
    ];
    const structured = [
      { label: 'Dayforce migration thread', type: 'chat', url: 'https://teams.microsoft.com' },
    ];
    const result = ctx.adoptStructuredLabels(inline, structured);
    assert.equal(result[0].label, 'Dayforce migration thread');
    assert.equal(result[1].label, 'Dayforce migration thread (2)');
    assert.equal(result[2].label, 'Dayforce migration thread (3)');
  });
});

describe('extractLabelEmbeddedUrl()', () => {
  it('returns null for empty/null input', () => {
    assert.equal(ctx.extractLabelEmbeddedUrl(null), null);
    assert.equal(ctx.extractLabelEmbeddedUrl(''), null);
  });

  it('extracts URL from label with embedded citation', () => {
    const label = 'Sentinel POC email thread [1](https://outlook.office365.com/owa/?ItemID=AAMk123)';
    const result = ctx.extractLabelEmbeddedUrl(label);
    assert.ok(result);
    assert.equal(result.cleanLabel, 'Sentinel POC email thread');
    assert.ok(result.url.includes('outlook.office365.com'));
  });

  it('returns null when label has no embedded citation', () => {
    const result = ctx.extractLabelEmbeddedUrl('Just a plain label');
    assert.equal(result, null);
  });

  it('strips multiple embedded citations from label', () => {
    const label = 'Thread context [2](https://teams.microsoft.com/l/message/19:abc/1) and more [3](https://teams.microsoft.com/l/message/19:def/2)';
    const result = ctx.extractLabelEmbeddedUrl(label);
    assert.ok(result);
    assert.equal(result.cleanLabel, 'Thread context and more');
    // Uses the last citation URL
    assert.ok(result.url.includes('19:def'));
  });
});

describe('normalizeEvidenceLink() with label-embedded URLs', () => {
  it('extracts URL from label when url field is missing', () => {
    const entry = {
      label: 'Teams chat about Contoso [1](https://teams.microsoft.com/l/message/19:abc@thread.v2/12345?context=%7B%22contextType%22:%22chat%22%7D)',
      type: 'chat',
      signalAt: null,
    };
    const result = ctx.normalizeEvidenceLink(entry, 'chat');
    assert.ok(result);
    // cleanDisplayText leaves 'Contoso' as-is (no camelCase split)
    assert.equal(result.label, 'Teams chat about Contoso');
    assert.ok(result.url.includes('teams.microsoft.com/l/message'));
    assert.equal(result.type, 'chat');
  });

  it('returns null when no url field and no embedded URL in label', () => {
    const entry = { label: 'Just a label', type: 'chat', signalAt: null };
    const result = ctx.normalizeEvidenceLink(entry, 'chat');
    assert.equal(result, null);
  });

  it('prefers explicit url field over label-embedded URL', () => {
    const entry = {
      label: 'Thread [1](https://teams.microsoft.com/l/message/19:fallback/1)',
      type: 'chat',
      url: 'https://teams.microsoft.com/l/message/19:explicit/2?context=%7B%7D',
      signalAt: null,
    };
    const result = ctx.normalizeEvidenceLink(entry, 'chat');
    assert.ok(result);
    assert.ok(result.url.includes('19:explicit'));
  });
});
