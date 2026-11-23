import { resolveAllowedReal } from '../fs/allowed';
import type { FileIndex } from '../files/indexer';
import type { Tool } from './types';

const MAX_CHARS = 8000;
const MAX_LISTED_SECTIONS = 40;

/** Read-only: read a document's text (all of it, or one section) from an allowed folder. */
export function createReadDocumentTool(
  index: FileIndex,
): Tool<{ path?: string; section?: string }, unknown> {
  return {
    name: 'read_document',
    permissions: ['files:read'],
    untrusted: true,
    description:
      'Read the text of one document (text, Markdown, PDF or DOCX) inside an allowed folder. ' +
      'Optionally pass a section (a heading, "page 3" or "lines 40") to read just that part. ' +
      'If the file cannot be read, the error says why — tell the user. Read-only.',
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', description: 'Absolute path of the file.' },
        section: { type: 'string', description: 'Part of the document to read.' },
      },
      required: ['path'],
      additionalProperties: false,
    },
    async execute(params) {
      if (typeof params.path !== 'string' || params.path.trim() === '') {
        throw new Error('A file path is required.');
      }
      const resolved = await resolveAllowedReal(params.path);
      const document = await index.loadDocument(resolved);
      if (!document.ok) {
        throw new Error(
          `Could not read "${document.name}": ${document.reason ?? 'unknown reason'}.`,
        );
      }

      const wanted = typeof params.section === 'string' ? params.section.trim().toLowerCase() : '';
      const selected = wanted
        ? document.chunks.filter((chunk) => chunk.section.toLowerCase().includes(wanted))
        : document.chunks;
      if (wanted && selected.length === 0) {
        return {
          file: document.name,
          path: document.path,
          found: false,
          note: `No section matching "${params.section}".`,
          availableSections: document.chunks
            .slice(0, MAX_LISTED_SECTIONS)
            .map((chunk) => chunk.section),
        };
      }

      let used = 0;
      const sections: Array<{ section: string; text: string }> = [];
      for (const chunk of selected) {
        if (used + chunk.text.length > MAX_CHARS && sections.length > 0) break;
        sections.push({ section: chunk.section, text: chunk.text.slice(0, MAX_CHARS) });
        used += chunk.text.length;
      }
      return {
        file: document.name,
        path: document.path,
        modified: document.modifiedAt ? new Date(document.modifiedAt).toISOString() : undefined,
        truncated: sections.length < selected.length,
        sections,
        availableSections: wanted
          ? undefined
          : document.chunks.slice(0, MAX_LISTED_SECTIONS).map((chunk) => chunk.section),
      };
    },
  };
}
