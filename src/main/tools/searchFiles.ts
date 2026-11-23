import type { FileIndex } from '../files/indexer';
import type { Tool } from './types';

/** Read-only: keyword search across files in folders the user chose to index. */
export function createSearchFilesTool(
  index: FileIndex,
): Tool<{ query?: string; limit?: number }, unknown> {
  return {
    name: 'search_files',
    permissions: ['files:read'],
    untrusted: true,
    description:
      'Search the contents and names of files in the folders the user has indexed. Returns file ' +
      'paths, the page/heading/line range of the best passage, its modified date and a snippet. ' +
      'Cite results as [file name › section]. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        query: { type: 'string', description: 'Keywords to look for.' },
        limit: { type: 'number', description: 'Maximum results (default 6, max 15).' },
      },
      required: ['query'],
      additionalProperties: false,
    },
    async execute(params) {
      const query = typeof params.query === 'string' ? params.query.trim() : '';
      if (!query) throw new Error('A query is required.');
      if (index.folderPaths().length === 0) {
        return { count: 0, note: 'The user has not chosen any folders to index yet.', results: [] };
      }
      const limit = Math.min(15, Math.max(1, Math.floor(Number(params.limit) || 6)));
      const hits = index.search(query, limit);
      return {
        count: hits.length,
        results: hits.map((hit) => ({
          file: hit.name,
          path: hit.path,
          section: hit.section,
          modified: new Date(hit.modifiedAt).toISOString(),
          snippet: hit.snippet,
          identicalCopies: hit.duplicates.length,
        })),
      };
    },
  };
}
