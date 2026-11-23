import type { Section } from './extract';

export const MAX_CHUNK_CHARS = 1200;
export const MAX_CHUNKS_PER_FILE = 2000;

export interface ChunkRecord {
  /** Citable location: a page, a heading, or a line range. */
  section: string;
  text: string;
}

function lineRange(from: number, to: number): string {
  return from === to ? `line ${from}` : `lines ${from}–${to}`;
}

function splitByLines(section: Section): ChunkRecord[] {
  const lines = section.text.split(/\r?\n/);
  const first = section.lineStart ?? 1;
  const chunks: ChunkRecord[] = [];
  let buffer: string[] = [];
  let length = 0;
  let from = first;

  const flush = (to: number) => {
    const text = buffer.join('\n').trim();
    if (text.length > 0) {
      const range = lineRange(from, to);
      chunks.push({ section: section.label ? `${section.label} (${range})` : range, text });
    }
    buffer = [];
    length = 0;
  };

  lines.forEach((rawLine, offset) => {
    // Hard-wrap pathological single lines (minified code, long CSV rows).
    const line = rawLine.length > MAX_CHUNK_CHARS ? rawLine.slice(0, MAX_CHUNK_CHARS) : rawLine;
    const lineNumber = first + offset;
    if (length + line.length + 1 > MAX_CHUNK_CHARS && buffer.length > 0) {
      flush(lineNumber - 1);
      from = lineNumber;
    }
    buffer.push(line);
    length += line.length + 1;
  });
  flush(first + lines.length - 1);
  return chunks;
}

function splitByParagraphs(section: Section): ChunkRecord[] {
  const paragraphs = section.text.split(/\n\s*\n/).map((paragraph) => paragraph.trim());
  const chunks: ChunkRecord[] = [];
  let buffer = '';

  const flush = () => {
    const text = buffer.trim();
    if (text.length > 0) chunks.push({ section: section.label, text });
    buffer = '';
  };

  for (const paragraph of paragraphs) {
    if (paragraph.length === 0) continue;
    if (paragraph.length > MAX_CHUNK_CHARS) {
      flush();
      for (let start = 0; start < paragraph.length; start += MAX_CHUNK_CHARS) {
        chunks.push({
          section: section.label,
          text: paragraph.slice(start, start + MAX_CHUNK_CHARS),
        });
      }
      continue;
    }
    if (buffer.length + paragraph.length + 2 > MAX_CHUNK_CHARS) flush();
    buffer += `${buffer ? '\n\n' : ''}${paragraph}`;
  }
  flush();

  if (chunks.length > 1) {
    return chunks.map((chunk, index) => ({
      ...chunk,
      section: `${section.label || 'text'} (part ${index + 1})`,
    }));
  }
  return chunks;
}

/** Split extracted sections into search-sized chunks that each keep a citable label. */
export function chunkSections(sections: Section[]): ChunkRecord[] {
  const chunks: ChunkRecord[] = [];
  for (const section of sections) {
    const text = section.text.trim();
    if (text.length === 0) continue;
    if (text.length <= MAX_CHUNK_CHARS) {
      let label = section.label;
      if (section.lineStart !== undefined) {
        const lines = text.split(/\r?\n/).length;
        const range = lineRange(section.lineStart, section.lineStart + lines - 1);
        label = label ? `${label} (${range})` : range;
      }
      chunks.push({ section: label || 'text', text });
    } else if (section.lineStart !== undefined) {
      chunks.push(...splitByLines(section));
    } else {
      chunks.push(...splitByParagraphs(section));
    }
    if (chunks.length >= MAX_CHUNKS_PER_FILE) return chunks.slice(0, MAX_CHUNKS_PER_FILE);
  }
  return chunks;
}
