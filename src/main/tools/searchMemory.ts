import type { SearchHitKind } from '../../shared/protocol';
import { searchAll, type SearchSources } from '../memory/searchAll';
import type { Tool } from './types';

const KINDS: SearchHitKind[] = ['memory', 'note', 'conversation'];

/** Read-only: search what the user saved (memory facts, notes) and past conversations. */
export function createSearchMemoryTool(
  sources: SearchSources,
): Tool<{ query?: string; kinds?: string[]; limit?: number }, unknown> {
  return {
    name: 'search_memory',
    permissions: ['memory:read'],
    untrusted: true,
    description:
      "Search the user's saved memory facts, saved notes and past conversation summaries by " +
      'keyword. Use it when the user refers to something they told you or saved earlier. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to look for.' },
        kinds: {
          type: 'array',
          items: { type: 'string', enum: KINDS },
          description: 'Limit the search to some kinds. Default: all.',
        },
        limit: { type: 'number', description: 'Maximum results (default 8, max 20).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(params) {
      const query = typeof params.query === 'string' ? params.query.trim() : '';
      if (!query) throw new Error('A query is required.');
      const kinds = Array.isArray(params.kinds)
        ? params.kinds.filter((kind): kind is SearchHitKind =>
            KINDS.includes(kind as SearchHitKind),
          )
        : undefined;
      const limit = Math.min(20, Math.max(1, Math.floor(Number(params.limit) || 8)));
      const hits = searchAll(sources, query, { kinds, limit });
      return {
        count: hits.length,
        results: hits.map((hit) => ({
          kind: hit.kind,
          title: hit.title,
          snippet: hit.snippet,
          updated: new Date(hit.updatedAt).toISOString(),
        })),
      };
    },
  };
}
