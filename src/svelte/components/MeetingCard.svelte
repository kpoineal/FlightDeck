<script>
  import { safeDate, shortTime } from '../lib/utils.js';
  import BriefingContent from './BriefingContent.svelte';

  let { meeting, briefing = null, unseen = false, expanded = false, generating = false, ontoggle, ongenerate } = $props();

  let hasBriefing = $derived(!!briefing);
  let severityClass = $derived(unseen ? 'briefed' : hasBriefing ? 'briefed' : 'unbriefed');
  let statusLabel = $derived(unseen ? 'New' : hasBriefing ? 'Briefed' : 'Unbriefed');
  let buttonLabel = $derived(hasBriefing ? 'Regenerate Briefing' : 'Generate Briefing');
  let when = $derived(safeDate(meeting.startAt, 'Unknown'));
  let timeLabel = $derived(shortTime(meeting.startAt));
  let isUrgent = $derived.by(() => {
    const match = timeLabel.match(/^in (\d+) min$/);
    return match ? parseInt(match[1], 10) <= 15 : timeLabel === 'now';
  });

  const cardId = `meeting-card-${meeting.id}`;
  const regionId = `meeting-region-${meeting.id}`;

  function handleToggle() {
    ontoggle?.({ meetingId: meeting.id, open: !expanded });
  }

  function handleGenerate() {
    ongenerate?.({ meetingId: meeting.id });
  }

  function handleKeydown(e) {
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault();
      handleToggle();
    }
  }

  function handleJoin(e) {
    e.stopPropagation();
    if (meeting.joinUrl) {
      window.open(meeting.joinUrl, '_blank', 'noopener,noreferrer');
    }
  }
</script>

<div
  class="meeting-card"
  class:meeting-card--urgent={isUrgent}
  class:meeting-card--expanded={expanded}
  data-briefing-meeting-id={meeting.id}
>
  <div
    class="meeting-card__header"
    role="button"
    tabindex="0"
    aria-expanded={expanded}
    aria-controls={regionId}
    id={cardId}
    on:click={handleToggle}
    on:keydown={handleKeydown}
  >
    <span class="pill {severityClass}">{statusLabel}</span>
    <span class="meeting-card__title">{meeting.title}</span>
    {#if timeLabel}
      <span class="meeting-card__time" class:meeting-card__time--urgent={isUrgent}>{timeLabel}</span>
    {/if}
    {#if meeting.organizer}
      <span class="meeting-card__organizer">· {meeting.organizer}</span>
    {/if}
    {#if meeting.joinUrl}
      <button class="meeting-card__join" on:click={handleJoin} title="Join meeting">Join</button>
    {/if}
    <span class="meeting-card__chevron" aria-hidden="true">{expanded ? '▾' : '▸'}</span>
  </div>

  {#if !expanded}
    {#if hasBriefing && briefing.headline}
      <div class="meeting-card__subtitle">{briefing.headline}</div>
    {:else if meeting.summary}
      <div class="meeting-card__subtitle">{meeting.summary}</div>
    {/if}
  {/if}

  {#if expanded}
    <div class="meeting-card__body" role="region" aria-labelledby={cardId} id={regionId}>
      <div class="meeting-card__meta">
        <span>📋 Organizer: {meeting.organizer || 'Unknown'}</span>
        <span>·</span>
        <span>When: {when}</span>
      </div>
      <div class="meeting-card__actions">
        <button class="small-btn primary" class:is-loading={generating} disabled={generating} on:click={handleGenerate}>
          {generating ? 'Generating...' : buttonLabel}
        </button>
      </div>
      {#if generating}
        <div class="meeting-card__generating">Generating briefing…</div>
      {/if}
      {#if briefing}
        <BriefingContent {briefing} />
      {:else}
        {#if meeting.summary}
          <div class="meeting-card__preview">
            <div class="meeting-card__preview-label">Quick Preview</div>
            <p>{meeting.summary}</p>
            <div class="meeting-card__preview-hint">Generate a full briefing for detailed analysis, talk track, and action items.</div>
          </div>
        {:else}
          <div class="empty">No briefing generated yet.</div>
        {/if}
      {/if}
    </div>
  {/if}
</div>

<style>
  .meeting-card {
    border: 1px solid var(--border-card);
    border-radius: var(--radius-lg);
    background: var(--bg-inset);
    overflow: hidden;
    transition: transform 0.3s cubic-bezier(0.2, 0, 0, 1), box-shadow 0.3s ease, border-color 0.3s ease;
    box-shadow: 0 2px 8px rgba(0, 0, 0, 0.12);
  }
  .meeting-card:hover {
    transform: translateY(-2px);
    border-color: var(--border-hover);
    box-shadow: var(--shadow-hover);
  }
  .meeting-card--urgent {
    border-left: 3px solid var(--color-elevated);
    background: linear-gradient(90deg, color-mix(in srgb, var(--color-elevated) 4%, transparent) 0%, transparent 40%);
  }
  .meeting-card--expanded {
    border-color: var(--border-active);
    box-shadow: var(--shadow-accent);
  }

  .meeting-card__header {
    width: 100%;
    display: flex;
    align-items: center;
    gap: 10px;
    padding: 12px 16px;
    background: none;
    border: none;
    font: inherit;
    color: var(--text);
    cursor: pointer;
    text-align: left;
  }
  .meeting-card__header:focus-visible {
    outline: 2px solid var(--accent);
    outline-offset: -2px;
    border-radius: var(--radius-lg);
  }

  .meeting-card__title {
    flex: 1;
    min-width: 0;
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    font-weight: 600;
    font-size: 0.9rem;
  }

  .meeting-card__time {
    color: var(--text-muted);
    font-size: 0.78rem;
    white-space: nowrap;
    flex-shrink: 0;
    font-variant-numeric: tabular-nums;
  }
  .meeting-card__time--urgent {
    color: var(--color-elevated);
    font-weight: 700;
    animation: urgentPulse 2s ease-in-out infinite;
  }

  .meeting-card__organizer {
    color: var(--text-dim);
    font-size: 0.78rem;
    white-space: nowrap;
    overflow: hidden;
    text-overflow: ellipsis;
    max-width: 140px;
    flex-shrink: 0;
  }

  .meeting-card__join {
    flex-shrink: 0;
    background: color-mix(in srgb, var(--accent) 12%, transparent);
    border: 1px solid color-mix(in srgb, var(--accent) 30%, transparent);
    border-radius: var(--radius-pill);
    color: var(--accent);
    font-size: 0.72rem;
    font-weight: 600;
    padding: 4px 12px;
    cursor: pointer;
    letter-spacing: 0.02em;
    text-transform: uppercase;
    transition: border-color 0.2s ease, background 0.2s ease, box-shadow 0.2s ease;
  }
  .meeting-card__join:hover {
    border-color: var(--accent);
    background: color-mix(in srgb, var(--accent) 18%, transparent);
    box-shadow: 0 0 8px color-mix(in srgb, var(--accent) 20%, transparent);
  }

  .meeting-card__chevron {
    color: var(--text-dim);
    font-size: 0.7rem;
    flex-shrink: 0;
    transition: transform 0.3s var(--transition-smooth);
  }

  .meeting-card__subtitle {
    padding: 0 16px 10px;
    font-size: 0.8rem;
    color: var(--text-muted);
    overflow: hidden;
    text-overflow: ellipsis;
    white-space: nowrap;
    border-top: 1px solid color-mix(in srgb, var(--border) 50%, transparent);
    margin: 0 16px;
    padding: 8px 0;
    font-style: italic;
  }

  .meeting-card__body {
    border-top: 1px solid var(--border);
    padding: 16px;
    background: color-mix(in srgb, var(--bg-surface) 40%, transparent);
  }

  .meeting-card__meta {
    display: flex;
    flex-wrap: wrap;
    gap: 8px;
    font-size: 0.82rem;
    color: var(--text-muted);
    margin-bottom: 14px;
    padding-bottom: 12px;
    border-bottom: 1px solid color-mix(in srgb, var(--border) 40%, transparent);
  }

  .meeting-card__actions {
    margin-bottom: 12px;
  }

  .meeting-card__generating {
    color: var(--text-muted);
    font-size: 0.85rem;
    padding: 0.5rem 0;
    animation: badgePulse 2s ease-in-out infinite;
  }

  @keyframes badgePulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.5; }
  }

  @keyframes urgentPulse {
    0%, 100% { opacity: 1; }
    50% { opacity: 0.6; }
  }

  .meeting-card__preview {
    background: color-mix(in srgb, var(--bg-raised) 60%, transparent);
    border: 1px solid var(--border);
    border-radius: var(--radius-md);
    padding: 12px 14px;
  }
  .meeting-card__preview-label {
    font-size: 0.7rem;
    font-weight: 600;
    text-transform: uppercase;
    letter-spacing: 0.04em;
    color: var(--text-dim);
    margin-bottom: 6px;
  }
  .meeting-card__preview p {
    font-size: 0.85rem;
    color: var(--text-secondary);
    line-height: 1.5;
    margin: 0;
  }
  .meeting-card__preview-hint {
    font-size: 0.75rem;
    color: var(--text-dim);
    margin-top: 8px;
    font-style: italic;
  }
</style>
