import { listFolder } from '../fs/allowed';
import type { Tool } from './types';

/**
 * Read-only tool: list one folder, restricted to the configured allowlisted roots
 * (Documents/Desktop/Downloads by default). Paths outside the allowlist are rejected.
 */
export const listFolderTool: Tool<{ path?: string }, unknown> = {
  name: 'list_folder',
  permissions: ['files:read'],
  untrusted: true,
  description:
    'List the contents of a folder on disk. The path must be inside an allowed folder ' +
    '(Documents, Desktop, Downloads by default). Omit the path to list the default folder. Read-only.',
  parameters: {
    type: 'object',
    properties: {
      path: {
        type: 'string',
        description: 'Absolute or ~-relative folder path inside an allowed root.',
      },
    },
    required: [],
    additionalProperties: false,
  },
  async execute(params) {
    const listing = await listFolder(params.path);
    return {
      path: listing.path,
      parent: listing.parent,
      truncated: listing.truncated,
      entries: listing.entries.slice(0, 50).map((entry) => ({
        name: entry.name,
        type: entry.type,
        sizeBytes: entry.type === 'file' ? entry.size : undefined,
      })),
    };
  },
};
