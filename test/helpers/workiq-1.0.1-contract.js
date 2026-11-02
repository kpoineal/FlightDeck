'use strict';

// Captured from bundled WorkIQ 1.0.1 (native 1.0.1.47154) tools/list.
const tools = [
  {
    name: 'ask',
    inputSchema: {
      type: 'object',
      properties: {
        question: { type: 'string' },
        fileUrls: { type: ['array', 'null'], items: { type: ['string', 'null'] }, default: null },
        conversationId: { type: ['string', 'null'], default: null },
        agentId: { type: ['string', 'null'], default: null },
      },
      required: ['question'],
    },
  },
  {
    name: 'fetch',
    inputSchema: {
      type: 'object',
      properties: {
        entityUrls: { type: 'array', items: { type: 'string' } },
        agentId: { type: ['string', 'null'], default: null },
      },
      required: ['entityUrls'],
    },
  },
  {
    name: 'create_entity',
    inputSchema: {
      type: 'object',
      properties: {
        parentUrl: { type: 'string' },
        jsonBody: {},
        agentId: { type: ['string', 'null'], default: null },
      },
      required: ['parentUrl', 'jsonBody'],
    },
  },
];

function fetchResult(data, statusCode = 200) {
  return { content: [], structuredContent: { results: [{ data, statusCode }] }, isError: false };
}

// Wrapper shape observed during the single approved Teams send on 2026-10-30.
// Status values in fixtures are representative; no live identifiers/body retained.
function createResult(data, statusCode = 201) {
  return { content: [], structuredContent: { statusCode, data }, isError: false };
}

module.exports = { tools, fetchResult, createResult };
