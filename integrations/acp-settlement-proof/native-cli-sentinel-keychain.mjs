// TEST ONLY: no OS store, credentials or keys are accessed or created.
export class InitError extends Error {}
export class KeyringLockedError extends Error {}
export class NoKeyringError extends Error {}
export class PasswordSetError extends Error {}
export async function getPassword() { return `offline.${Buffer.from(JSON.stringify({ exp: 4102444800 })).toString('base64url')}.sentinel`; }
export async function setPassword() { throw Error('Synthetic CLI must not persist credentials'); }
export async function useBackend() { throw Error('Synthetic CLI must not select a credential backend'); }
