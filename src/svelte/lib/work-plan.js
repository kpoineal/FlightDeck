import { isWorkPlanStepCompleted, normalizeWorkPlanStep } from './action-proposals.js';

export function normalizeWorkPlanChoice(choice) {
  if (!choice || !['custom', 'recommended'].includes(choice.mode)) return null;
  return {
    mode: choice.mode,
    customText: typeof choice.customText === 'string' ? choice.customText.slice(0, 500) : '',
    selectedNextStep: typeof choice.selectedNextStep === 'string' ? choice.selectedNextStep : '',
  };
}

export function resolveWorkPlan(item, composer = {}) {
  const moves = Array.isArray(item?.suggestedNextSteps) ? item.suggestedNextSteps.slice(0, 2) : [];
  const available = moves.filter((step) => !isWorkPlanStepCompleted(item, step));
  const choice = item?.workPlanChoice || {};
  const custom = choice.mode === 'custom';
  const customText = typeof choice.customText === 'string' ? choice.customText : '';
  const preferred = choice.selectedNextStep ?? composer.selectedNextStep;
  const step = custom ? customText.trim() : available.includes(preferred) ? preferred : available[0] || '';
  const completed = moves.length > 0 && !available.length;
  return {
    moves, custom, customText, step, completed,
    blockedReason: custom && !step ? 'Enter a custom next move before drafting.'
      : isWorkPlanStepCompleted(item, step) || (!custom && completed)
        ? 'This next move is complete. Write a custom next move for a new follow-up.' : '',
  };
}

export function draftMatchesWorkPlan(draftStep, selectedStep) {
  return normalizeWorkPlanStep(draftStep) === normalizeWorkPlanStep(selectedStep);
}
