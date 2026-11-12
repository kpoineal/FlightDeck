import { normalizeItem } from './models/item.js';
import { activeMatchThread } from './thread-matching.js';
import { cleanDisplayText } from './utils.js';

export function meetingFollowUpId(meeting) {
  return `meeting_followup_${meeting.id}`;
}

export function prepareMeetingFollowUp(meeting, briefing, threads, deletedIds = []) {
  if (!meeting?.id) return null;
  const eligible = threads.filter(item => !deletedIds.includes(item.id) && activeMatchThread(item));
  const title = String(meeting.title || '').trim();
  const exact = eligible.filter(item => title && item.title?.trim().toLowerCase() === title.toLowerCase());
  // A shared customer word is not evidence that two tasks are the same deliverable.
  const matched = eligible.find(item => item.id === meetingFollowUpId(meeting))
    || (exact.length === 1 ? exact[0] : null);
  const unavailableIds = new Set([...deletedIds, ...threads.map(item => item.id)]);
  let newId = meetingFollowUpId(meeting);
  let suffix = 2;
  while (unavailableIds.has(newId)) newId = `${meetingFollowUpId(meeting)}_${suffix++}`;
  const step = `Prepare a follow-up for ${title || 'this meeting'} using the meeting context and linked briefing evidence.`;
  const context = cleanDisplayText([meeting.summary, briefing?.headline, ...(briefing?.bullets || [])].filter(Boolean).join('\n'));
  const summary = context && !String(matched?.summary || '').includes(context)
    ? [context, matched?.summary].filter(Boolean).join('\n\n') : matched?.summary || context;
  const item = normalizeItem({
    ...(matched || {
      id: newId,
      title: title || 'Meeting follow-up',
      origin: 'custom', sourceType: 'Meeting', status: 'Inbound', lifecycleStatus: 'in-progress',
      monitorPrompt: context, monitorEnabled: false,
      owner: meeting.organizer, counterparties: [meeting.organizer].filter(Boolean),
    }),
    summary,
    evidenceLinks: [
      ...(matched?.evidenceLinks || []),
      ...(briefing?.sources || []).map(source => ({ label: source.label, url: source.url, type: 'source' })),
      ...(meeting.joinUrl ? [{ label: 'Meeting', url: meeting.joinUrl }] : []),
    ],
  });
  const hasExistingPlan = Boolean(matched && (item.workPlanChoice || item.suggestedNextSteps.length));
  return {
    item,
    created: !matched,
    suggestedNextSteps: hasExistingPlan ? item.suggestedNextSteps : [step],
    workPlanChoice: hasExistingPlan
      ? item.workPlanChoice || { mode: 'recommended', selectedNextStep: item.suggestedNextSteps[0] }
      : { mode: 'recommended', selectedNextStep: step },
  };
}
