const CONTROL_PATTERN = /[\x00-\x1f\x7f]/;
const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const TEAMS_FIELDS = new Set(['targetDisplayName', 'targetEmail', 'message']);

export function isValidEmail(value) {
  return typeof value === 'string' && value.length <= 254
    && !CONTROL_PATTERN.test(value) && EMAIL_PATTERN.test(value);
}

export function normalizeTeamsMessage(value) {
  const invalid = () => { const error = new Error('INVALID_MESSAGE'); error.code = 'INVALID_MESSAGE'; throw error; };
  if (!value || typeof value !== 'object' || Array.isArray(value)
    || Object.keys(value).some(key => !TEAMS_FIELDS.has(key))
    || typeof value.targetDisplayName !== 'string'
    || typeof value.message !== 'string') return invalid();
  const targetDisplayName = value.targetDisplayName.trim();
  const message = value.message.trim();
  if (value.targetDisplayName.length > 160 || CONTROL_PATTERN.test(value.targetDisplayName)
    || !message || message.length > 4000 || /[\x00-\x08\x0b\x0c\x0e-\x1f\x7f]/.test(value.message)) return invalid();
  if (value.targetEmail !== undefined
    && (typeof value.targetEmail !== 'string' || CONTROL_PATTERN.test(value.targetEmail)
      || !isValidEmail(value.targetEmail.trim()))) return invalid();
  const targetEmail = value.targetEmail?.trim();
  if (!targetDisplayName && !targetEmail) return invalid();
  return { targetDisplayName, ...(targetEmail ? { targetEmail } : {}), message };
}
