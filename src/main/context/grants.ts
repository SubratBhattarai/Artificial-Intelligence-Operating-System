import type { ContextGrant } from '../../shared/protocol';

/**
 * Opt-in context access, scoped to the running session: it lives only in memory, so it is
 * off at every launch and can be revoked at any time. Nothing is ever persisted.
 */
let grant: ContextGrant = { windows: false, grantedAt: null };

export function getContextGrant(): ContextGrant {
  return { ...grant };
}

export function setContextGrant(patch: { windows?: boolean }, now = Date.now()): ContextGrant {
  if (typeof patch.windows === 'boolean') {
    grant = patch.windows ? { windows: true, grantedAt: now } : { windows: false, grantedAt: null };
  }
  return getContextGrant();
}

export function resetContextGrant(): void {
  grant = { windows: false, grantedAt: null };
}
