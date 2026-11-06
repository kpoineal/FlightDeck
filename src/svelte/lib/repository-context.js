export const usesRepository = () => typeof globalThis.window?.workiq?.stateQuery === 'function';
let remember = () => {};
export function registerRepositoryProjection(callback) { remember = callback; }
export function rememberRepositoryThread(item) { remember(item); }
