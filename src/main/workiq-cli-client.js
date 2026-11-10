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
      let entity;
      try {
        entity = JSON.parse(result.answer);
      } catch (error) {
        if (!(error instanceof SyntaxError)) throw error;
        throw failure('INVALID_RESPONSE');
      }
      if (!entity || typeof entity !== 'object' || Array.isArray(entity)) throw failure('INVALID_RESPONSE');
      if (entity.error || entity.isError === true) {
        return { isError: true, content: [], structuredContent: { error: entity.error || { message: 'CLI operation failed' } } };
      }
      // CLI entity commands return the entity itself, not an MCP status/data wrapper.
      return { isError: false, content: [{ type: 'text', text: JSON.stringify(entity) }] };
    },
  });
}

module.exports = { createWorkiqCliClient };
