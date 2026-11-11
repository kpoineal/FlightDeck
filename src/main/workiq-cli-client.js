'use strict';

const { runWorkiqCommand, runWorkiqCli } = require('./pty-bridge');
const { createWorkiqMcpClient } = require('./workiq-mcp-client');
const { logError } = require('./utils');

function failure(code) {
  logError('[main] WorkIQ CLI operation failed:', code);
  return Object.assign(new Error(code), { code });
}

function createWorkiqCliClient(options = {}) {
  const run = (args, queryOptions) => runWorkiqCli(args, { ...options, ...queryOptions });
  return createWorkiqMcpClient({
    ...options,
    transportName: 'cli',
    semanticQuery: (question, queryOptions) => runWorkiqCommand(question, { ...options, ...queryOptions }),
    discoverTools: async (queryOptions) => {
      const result = await run(['--help'], queryOptions);
      if (!result.success) throw failure(result.code);
      if (!['ask', 'fetch', 'create'].every(command => new RegExp(`^\\s+${command}\\s`, 'm').test(result.answer))) {
        throw failure('UNSUPPORTED');
      }
      return new Set(['ask', 'fetch', 'create_entity']);
    },
    toolQuery: async (name, args, queryOptions) => {
      let command;
      if (name === 'fetch' && Array.isArray(args.entityUrls) && args.entityUrls.length === 1) {
        command = ['fetch', '--urls', args.entityUrls[0]];
      } else if (name === 'create_entity' && typeof args.parentUrl === 'string' && args.jsonBody) {
        command = ['create', '--url', args.parentUrl, '--body', JSON.stringify(args.jsonBody)];
      } else {
        throw failure('UNSUPPORTED');
      }
      const result = await run(command, queryOptions);
      if (!result.success) throw failure(result.code);
      // WorkIQ 1.0.1 prefixes create receipts with "Created (HTTP 201):".
      const receipt = command[0] === 'create'
        ? /^Created \(HTTP ([1-5]\d{2})\):\r?\n/.exec(result.answer) : null;
      let entity;
      try {
        entity = JSON.parse(receipt ? result.answer.slice(receipt[0].length) : result.answer);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw failure('INVALID_RESPONSE');
      }
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) throw failure('INVALID_RESPONSE');
      if (entity.error || entity.isError === true) {
        return { isError: true, content: [], structuredContent: { error: entity.error || { message: 'CLI operation failed' } } };
      }
      if (receipt) {
        return { isError: false, content: [], structuredContent: { statusCode: Number(receipt[1]), data: entity } };
      }
      if (command[0] === 'fetch' && Array.isArray(entity.results)) {
        return { isError: false, content: [], structuredContent: entity };
      }
      return { isError: false, content: [{ type: 'text', text: JSON.stringify(entity) }] };
    },
  });
}

module.exports = { createWorkiqCliClient };
