import type { MemoryStore } from '../memory/memoryStore';
import type { Tool } from './types';

const MAX_PENDING = 20;
const DAY_MS = 24 * 60 * 60 * 1000;

/**
 * Not a write to the user's memory: it stages a *suggestion* that stays inert until the user
 * approves it in the Memory app. Rejecting it deletes it. See ADR 0005.
 */
export function createProposeMemoryTool(
  memory: MemoryStore,
): Tool<{ fact?: string; confidence?: number; expires_in_days?: number }, unknown> {
  return {
    name: 'propose_memory',
    permissions: ['memory:suggest'],
    description:
      'Suggest saving one durable fact about the user for later (a preference, a stable detail ' +
      'they told you). It is NOT saved until the user approves it. Only propose facts the user ' +
      'stated themselves, never guesses. Do not propose secrets, passwords or sensitive data.',
    parameters: {
      type: 'object',
      properties: {
        fact: { type: 'string', description: 'One short, self-contained statement.' },
        confidence: { type: 'number', description: '0 to 1: how sure you are it is accurate.' },
        expires_in_days: {
          type: 'number',
          description: 'Optional: days until the fact should be forgotten (for temporary facts).',
        },
      },
      required: ['fact'],
      additionalProperties: false,
    },
    async execute(params, ctx) {
      if (typeof params.fact !== 'string') throw new Error('A fact is required.');
      if (memory.list({ status: 'pending' }).length >= MAX_PENDING) {
        throw new Error(
          'There are already many suggestions waiting for review. Do not propose more.',
        );
      }
      const days = Number(params.expires_in_days);
      const record = memory.add(
        {
          fact: params.fact,
          confidence: typeof params.confidence === 'number' ? params.confidence : undefined,
          expiresAt: Number.isFinite(days) && days > 0 ? Date.now() + days * DAY_MS : null,
        },
        {
          status: 'pending',
          source: { kind: 'suggested', sessionId: ctx.sessionId, label: 'Suggested by JARVIS' },
        },
      );
      return {
        saved: record.status === 'active',
        status: record.status,
        note:
          record.status === 'pending'
            ? 'Suggestion recorded. It will be used only after the user approves it.'
            : 'This fact is already in memory.',
      };
    },
  };
}
