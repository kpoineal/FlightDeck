'use strict';

require('./helpers/electron-mock');

const { describe, it } = require('node:test');
const assert = require('node:assert/strict');

const {
  ts,
  normalizeExternalUrl,
  isSafeExternalUrl,
  escapeHtml,
  markdownToHtml,
} = require('../src/main/utils');

/* ------------------------------------------------------------------ */
/*  ts()                                                               */
/* ------------------------------------------------------------------ */
describe('ts()', () => {
  it('returns an ISO 8601 timestamp', () => {
    assert.match(ts(), /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{3}Z$/);
  });
});

/* ------------------------------------------------------------------ */
/*  normalizeExternalUrl()                                             */
/* ------------------------------------------------------------------ */
describe('normalizeExternalUrl()', () => {
  it('returns null for falsy input', () => {
    assert.equal(normalizeExternalUrl(null), null);
    assert.equal(normalizeExternalUrl(undefined), null);
    assert.equal(normalizeExternalUrl(''), null);
  });

  it('normalizes a valid https URL', () => {
    assert.equal(normalizeExternalUrl('https://example.com'), 'https://example.com/');
  });

  it('normalizes a valid http URL', () => {
    assert.equal(normalizeExternalUrl('http://example.com'), 'http://example.com/');
  });

  it('decodes &amp; entities', () => {
    assert.equal(
      normalizeExternalUrl('https://example.com?a=1&amp;b=2'),
      'https://example.com/?a=1&b=2'
    );
  });

  it('strips whitespace and newlines', () => {
    assert.equal(
      normalizeExternalUrl('  https://example.com/path  \n '),
      'https://example.com/path'
    );
  });

  it('prepends https:// to domain-like strings', () => {
    assert.equal(normalizeExternalUrl('example.com'), 'https://example.com/');
    assert.equal(normalizeExternalUrl('example.com/path'), 'https://example.com/path');
  });

  it('returns null for non-URL strings', () => {
    assert.equal(normalizeExternalUrl('not a url'), null);
    assert.equal(normalizeExternalUrl('just-text'), null);
  });

  it('returns null for non-http protocols', () => {
    assert.equal(normalizeExternalUrl('ftp://example.com'), null);
    assert.equal(normalizeExternalUrl('file:///etc/passwd'), null);
  });

  it('handles URLs with paths and query strings', () => {
    assert.equal(
      normalizeExternalUrl('https://example.com/path?q=hello&r=world'),
      'https://example.com/path?q=hello&r=world'
    );
  });
});

/* ------------------------------------------------------------------ */
/*  isSafeExternalUrl()                                                */
/* ------------------------------------------------------------------ */
describe('isSafeExternalUrl()', () => {
  it('returns true for valid http/https URLs', () => {
    assert.equal(isSafeExternalUrl('https://example.com'), true);
    assert.equal(isSafeExternalUrl('http://example.com'), true);
  });

  it('returns false for invalid or unsafe input', () => {
    assert.equal(isSafeExternalUrl(''), false);
    assert.equal(isSafeExternalUrl(null), false);
    assert.equal(isSafeExternalUrl('javascript:alert(1)'), false);
    assert.equal(isSafeExternalUrl('ftp://example.com'), false);
  });
});

/* ------------------------------------------------------------------ */
/*  escapeHtml()                                                       */
/* ------------------------------------------------------------------ */
describe('escapeHtml()', () => {
  it('escapes ampersands', () => {
    assert.equal(escapeHtml('a & b'), 'a &amp; b');
  });

  it('escapes angle brackets', () => {
    assert.equal(escapeHtml('<div>'), '&lt;div&gt;');
  });

  it('escapes double quotes', () => {
    assert.equal(escapeHtml('"hello"'), '&quot;hello&quot;');
  });

  it('escapes single quotes', () => {
    assert.equal(escapeHtml("'hello'"), '&#39;hello&#39;');
  });

  it('escapes all special characters together', () => {
    assert.equal(
      escapeHtml('<a href="x">&</a>'),
      '&lt;a href=&quot;x&quot;&gt;&amp;&lt;/a&gt;'
    );
  });

  it('converts non-string values to strings', () => {
    assert.equal(escapeHtml(42), '42');
    assert.equal(escapeHtml(true), 'true');
  });
});

/* ------------------------------------------------------------------ */
/*  markdownToHtml()                                                   */
/* ------------------------------------------------------------------ */
describe('markdownToHtml()', () => {
  it('converts headings', () => {
    assert.equal(markdownToHtml('# Title'), '<h1>Title</h1>');
    assert.equal(markdownToHtml('## Subtitle'), '<h2>Subtitle</h2>');
    assert.equal(markdownToHtml('### H3'), '<h3>H3</h3>');
  });

  it('converts dash bullet lists', () => {
    const md = '- one\n- two';
    assert.equal(markdownToHtml(md), '<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
  });

  it('converts asterisk bullet lists', () => {
    const md = '* one\n* two';
    assert.equal(markdownToHtml(md), '<ul>\n<li>one</li>\n<li>two</li>\n</ul>');
  });

  it('converts plain text to paragraphs', () => {
    assert.equal(markdownToHtml('Hello world'), '<p>Hello world</p>');
  });

  it('escapes HTML inside markdown', () => {
    assert.equal(markdownToHtml('# <script>'), '<h1>&lt;script&gt;</h1>');
  });

  it('handles empty/null input', () => {
    assert.equal(markdownToHtml(''), '');
    assert.equal(markdownToHtml(null), '');
  });

  it('handles mixed content with blank-line separators', () => {
    const md = '# Title\n\nParagraph\n\n- bullet\n\nAnother paragraph';
    const html = markdownToHtml(md);
    assert.ok(html.includes('<h1>Title</h1>'));
    assert.ok(html.includes('<p>Paragraph</p>'));
    assert.ok(html.includes('<li>bullet</li>'));
    assert.ok(html.includes('<p>Another paragraph</p>'));
  });

  it('closes list before heading', () => {
    const md = '- item\n# Heading';
    const html = markdownToHtml(md);
    const listEnd = html.indexOf('</ul>');
    const headingStart = html.indexOf('<h1>');
    assert.ok(listEnd < headingStart, 'list should close before heading');
  });
});
