<script>
  import { mode } from './lib/stores.js';
  import HistoryView from './components/HistoryView.svelte';
  import BriefingsView from './components/BriefingsView.svelte';

  const demoHistory = [
    {
      kind: 'scan',
      at: '2026-04-15T08:30:00Z',
      summary: 'Scanned 12 mailbox threads and 4 Teams channels for new signals.',
      payload: {
        newLinks: [
          { type: 'email', url: 'https://example.com/thread/101', label: 'Budget review thread' },
          { type: 'teams', url: 'https://example.com/teams/general', label: '#general channel' },
        ],
      },
    },
    {
      kind: 'startup',
      at: '2026-04-15T08:00:00Z',
      summary: 'FlightDeck session started. Loaded 47 tracked items from store.',
      payload: {},
    },
    {
      kind: 'recommendation',
      at: '2026-04-14T17:45:00Z',
      summary: 'Suggested escalating "Azure cost anomaly" to Critical based on trend analysis.',
      payload: {
        newLinks: [
          { type: 'doc', url: 'https://example.com/docs/cost-report', label: 'Cost report Q2' },
        ],
      },
    },
    {
      kind: 'failure',
      at: '2026-04-14T14:12:00Z',
      summary: 'Scanner "Jira backlog sync" failed: connection timeout after 30 s.',
      payload: {},
    },
  ];
</script>

<div class="svelte-root">
  {#if $mode === 'Briefings'}
    <BriefingsView />
  {:else if $mode === 'History'}
    <HistoryView history={demoHistory} />
  {/if}
</div>
