import path from 'node:path';
import { officeSectionsFromBuffer } from './office';

/* eslint-disable @typescript-eslint/no-require-imports */

export const MAX_TEXT_BYTES = 5 * 1024 * 1024;
export const MAX_BINARY_BYTES = 30 * 1024 * 1024;

const TEXT_EXTENSIONS = new Set([
  'txt',
  'text',
  'log',
  'csv',
  'tsv',
  'json',
  'jsonl',
  'ipynb',
  'yaml',
  'yml',
  'toml',
  'ini',
  'cfg',
  'conf',
  'xml',
  'html',
  'htm',
  'css',
  'scss',
  'rst',
  'tex',
  'bib',
  'srt',
  'vtt',
  'js',
  'jsx',
  'mjs',
  'cjs',
  'ts',
  'tsx',
  'py',
  'java',
  'c',
  'h',
  'cpp',
  'hpp',
  'cs',
  'go',
  'rs',
  'rb',
  'php',
  'sh',
  'bat',
  'ps1',
  'sql',
  'r',
  'm',
  'swift',
  'kt',
  'lua',
  'ino',
  'gradle',
]);
const MARKDOWN_EXTENSIONS = new Set(['md', 'markdown', 'mdx']);
export const IMAGE_EXTENSIONS = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp']);

export type FileKind = 'text' | 'markdown' | 'pdf' | 'docx' | 'xlsx' | 'pptx' | 'image' | 'other';

export function classifyFile(ext: string): FileKind {
  const lower = ext.toLowerCase();
  if (MARKDOWN_EXTENSIONS.has(lower)) return 'markdown';
  if (TEXT_EXTENSIONS.has(lower)) return 'text';
  if (lower === 'pdf') return 'pdf';
  if (lower === 'docx') return 'docx';
  if (lower === 'xlsx') return 'xlsx';
  if (lower === 'pptx') return 'pptx';
  if (IMAGE_EXTENSIONS.has(lower)) return 'image';
  return 'other';
}

export function extensionOf(name: string): string {
  return path.extname(name).slice(1).toLowerCase();
}

/**
 * A readable region of a file. `lineStart` is set for line-oriented text so chunk labels can cite
 * line ranges; PDFs use one section per page and DOCX/Markdown one section per heading.
 */
export interface Section {
  label: string;
  text: string;
  lineStart?: number;
}

export type Extraction =
  | { ok: true; sections: Section[] }
  | { ok: false; status: 'unreadable' | 'unsupported'; reason: string };

/** Optional dependencies are loaded lazily so the app still runs before `npm install` adds them. */
function loadOptional<T>(names: string[]): T | null {
  for (const name of names) {
    try {
      return require(name) as T;
    } catch {
      // try the next candidate
    }
  }
  return null;
}

function decodeText(buffer: Buffer): { ok: true; text: string } | { ok: false; reason: string } {
  if (buffer.length >= 2 && buffer[0] === 0xff && buffer[1] === 0xfe) {
    return { ok: true, text: buffer.subarray(2).toString('utf16le') };
  }
  const head = buffer.subarray(0, Math.min(buffer.length, 4096));
  if (head.includes(0)) return { ok: false, reason: 'looks like a binary file, not text' };
  const start =
    buffer.length >= 3 && buffer[0] === 0xef && buffer[1] === 0xbb && buffer[2] === 0xbf ? 3 : 0;
  return { ok: true, text: buffer.subarray(start).toString('utf8') };
}

function markdownSections(text: string): Section[] {
  const lines = text.split(/\r?\n/);
  const sections: Section[] = [];
  let label = 'Start';
  let startLine = 1;
  let buffer: string[] = [];
  let inFence = false;

  const flush = () => {
    const body = buffer.join('\n').trim();
    if (body.length > 0) sections.push({ label, text: body, lineStart: startLine });
    buffer = [];
  };

  lines.forEach((line, index) => {
    if (/^\s*(```|~~~)/.test(line)) inFence = !inFence;
    const heading = inFence ? null : line.match(/^(#{1,6})\s+(.+?)\s*#*\s*$/);
    if (heading) {
      flush();
      label = heading[2].trim();
      startLine = index + 1;
      buffer.push(line);
    } else {
      buffer.push(line);
    }
  });
  flush();
  return sections;
}

function decodeEntities(value: string): string {
  return value
    .replace(/&nbsp;/g, ' ')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&amp;/g, '&');
}

function htmlToMarkdownish(html: string): string {
  return decodeEntities(
    html
      .replace(/<h([1-6])[^>]*>([\s\S]*?)<\/h\1>/gi, (_match, level: string, inner: string) => {
        return `\n\n${'#'.repeat(Number(level))} ${inner.replace(/<[^>]+>/g, '').trim()}\n\n`;
      })
      .replace(/<\/(p|li|tr|div)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ''),
  );
}

interface PdfParseResult {
  text: string;
}
type PdfParse = (
  data: Buffer,
  options?: { pagerender?: (page: unknown) => Promise<string>; max?: number },
) => Promise<PdfParseResult>;

async function extractPdf(buffer: Buffer): Promise<Extraction> {
  const pdfParse = loadOptional<PdfParse>(['pdf-parse/lib/pdf-parse.js', 'pdf-parse']);
  if (!pdfParse) {
    return {
      ok: false,
      status: 'unreadable',
      reason: 'PDF support is not installed — run "npm install" to add pdf-parse.',
    };
  }
  const pages: string[] = [];
  const pagerender = async (page: unknown): Promise<string> => {
    const pageData = page as {
      getTextContent: (options: object) => Promise<{
        items: Array<{ str: string; transform: number[] }>;
      }>;
    };
    const content = await pageData.getTextContent({
      normalizeWhitespace: false,
      disableCombineTextItems: false,
    });
    let lastY: number | undefined;
    let text = '';
    for (const item of content.items) {
      if (lastY === undefined || lastY === item.transform[5]) text += item.str;
      else text += `\n${item.str}`;
      lastY = item.transform[5];
    }
    pages.push(text);
    return text;
  };
  try {
    await pdfParse(buffer, { pagerender, max: 0 });
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    if (/password/i.test(message)) {
      return { ok: false, status: 'unreadable', reason: 'the PDF is password-protected' };
    }
    return { ok: false, status: 'unreadable', reason: `the PDF could not be parsed (${message})` };
  }
  const sections = pages
    .map((text, index) => ({ label: `page ${index + 1}`, text: text.trim() }))
    .filter((section) => section.text.length > 0);
  if (sections.reduce((total, section) => total + section.text.length, 0) < 20) {
    return {
      ok: false,
      status: 'unreadable',
      reason: 'no extractable text — this is probably a scanned image PDF (OCR is not available)',
    };
  }
  return { ok: true, sections };
}

interface Mammoth {
  convertToHtml: (input: { buffer: Buffer }) => Promise<{ value: string }>;
}

async function extractDocx(buffer: Buffer): Promise<Extraction> {
  const mammoth = loadOptional<Mammoth>(['mammoth']);
  if (!mammoth) {
    return {
      ok: false,
      status: 'unreadable',
      reason: 'DOCX support is not installed — run "npm install" to add mammoth.',
    };
  }
  try {
    const { value } = await mammoth.convertToHtml({ buffer });
    const sections = markdownSections(htmlToMarkdownish(value)).map((section) => ({
      label: section.label,
      text: section.text,
    }));
    if (sections.length === 0) {
      return { ok: false, status: 'unreadable', reason: 'the document has no text' };
    }
    return { ok: true, sections };
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      ok: false,
      status: 'unreadable',
      reason: `the document could not be parsed (${message})`,
    };
  }
}

/** Reads text out of a picture (offline OCR). Set once at startup; images are only read on request. */
let imageTextReader: ((image: Buffer) => Promise<string>) | null = null;
export function setImageTextReader(reader: ((image: Buffer) => Promise<string>) | null): void {
  imageTextReader = reader;
}

async function extractImage(buffer: Buffer): Promise<Extraction> {
  if (!imageTextReader) {
    return { ok: false, status: 'unsupported', reason: 'text recognition is not available' };
  }
  try {
    const text = (await imageTextReader(buffer)).trim();
    return text
      ? { ok: true, sections: [{ label: 'Text in image', text }] }
      : { ok: false, status: 'unreadable', reason: 'no readable text was found in the image' };
  } catch (error) {
    return {
      ok: false,
      status: 'unreadable',
      reason: `text recognition failed (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}

/** Turn a file's bytes into labelled sections. Never throws. */
export async function extractFromBuffer(buffer: Buffer, kind: FileKind): Promise<Extraction> {
  switch (kind) {
    case 'pdf':
      return extractPdf(buffer);
    case 'docx':
      return extractDocx(buffer);
    case 'xlsx':
    case 'pptx': {
      const result = await officeSectionsFromBuffer(buffer, kind);
      return result.ok
        ? { ok: true, sections: result.sections }
        : { ok: false, status: 'unreadable', reason: result.reason };
    }
    case 'image':
      return extractImage(buffer);
    case 'markdown':
    case 'text': {
      const decoded = decodeText(buffer);
      if (!decoded.ok) return { ok: false, status: 'unreadable', reason: decoded.reason };
      if (decoded.text.trim().length === 0) {
        return { ok: false, status: 'unreadable', reason: 'the file is empty' };
      }
      return {
        ok: true,
        sections:
          kind === 'markdown'
            ? markdownSections(decoded.text)
            : [{ label: '', text: decoded.text, lineStart: 1 }],
      };
    }
    default:
      return { ok: false, status: 'unsupported', reason: 'this file type is not text-searchable' };
  }
}
