import fs from 'node:fs/promises';
import path from 'node:path';
import type { FilePreview } from '../../shared/protocol';
import { classifyFile, extensionOf, IMAGE_EXTENSIONS } from './extract';
import type { FileIndex } from './indexer';

const PREVIEW_BYTES = 64 * 1024;
const PREVIEW_CHARS = 20_000;
const MAX_IMAGE_BYTES = 5 * 1024 * 1024;

const IMAGE_MIME: Record<string, string> = {
  png: 'image/png',
  jpg: 'image/jpeg',
  jpeg: 'image/jpeg',
  gif: 'image/gif',
  webp: 'image/webp',
  bmp: 'image/bmp',
};

/** Extensions that would run code if handed to the operating system's default opener. */
const NEVER_OPEN = new Set([
  'exe',
  'com',
  'bat',
  'cmd',
  'msi',
  'msp',
  'scr',
  'pif',
  'lnk',
  'url',
  'reg',
  'hta',
  'cpl',
  'msc',
  'ps1',
  'psm1',
  'vbs',
  'vbe',
  'js',
  'jse',
  'wsf',
  'wsh',
  'jar',
  'dll',
  'py',
  'pyw',
  'sh',
  'command',
  'app',
  'apk',
  'appimage',
  'deb',
  'rpm',
  'dmg',
  'iso',
]);

export function isOpenable(name: string): boolean {
  return !NEVER_OPEN.has(extensionOf(name));
}

/**
 * Read-only preview. Text and Markdown show the start of the file, PDF/DOCX show extracted
 * text, small images are embedded. Nothing is ever written.
 */
export async function previewFile(realPath: string, index: FileIndex): Promise<FilePreview> {
  const name = path.basename(realPath);
  let stats;
  try {
    stats = await fs.stat(realPath);
  } catch (error) {
    return {
      path: realPath,
      name,
      size: 0,
      modifiedAt: 0,
      kind: 'error',
      error: error instanceof Error ? error.message : String(error),
    };
  }
  const base = { path: realPath, name, size: stats.size, modifiedAt: stats.mtimeMs };
  if (!stats.isFile()) return { ...base, kind: 'unsupported', error: 'Not a file.' };

  const ext = extensionOf(name);
  if (IMAGE_EXTENSIONS.has(ext)) {
    if (stats.size > MAX_IMAGE_BYTES) {
      return { ...base, kind: 'unsupported', error: 'Image is too large to preview.' };
    }
    const bytes = await fs.readFile(realPath);
    return {
      ...base,
      kind: 'image',
      dataUrl: `data:${IMAGE_MIME[ext]};base64,${bytes.toString('base64')}`,
    };
  }

  const kind = classifyFile(ext);
  if (kind === 'pdf' || kind === 'docx') {
    const document = await index.loadDocument(realPath);
    if (!document.ok) {
      return { ...base, kind: 'error', error: `Could not read this file: ${document.reason}` };
    }
    let text = '';
    for (const chunk of document.chunks) {
      text += `— ${chunk.section} —\n${chunk.text}\n\n`;
      if (text.length > PREVIEW_CHARS) break;
    }
    return {
      ...base,
      kind: 'text',
      text: text.slice(0, PREVIEW_CHARS),
      truncated: text.length > PREVIEW_CHARS,
    };
  }

  if (kind === 'text' || kind === 'markdown') {
    const handle = await fs.open(realPath, 'r');
    try {
      const buffer = Buffer.alloc(Math.min(PREVIEW_BYTES, stats.size));
      await handle.read(buffer, 0, buffer.length, 0);
      if (buffer.subarray(0, 4096).includes(0)) {
        return { ...base, kind: 'unsupported', error: 'This looks like a binary file.' };
      }
      return {
        ...base,
        kind: 'text',
        text: buffer.toString('utf8').slice(0, PREVIEW_CHARS),
        truncated: stats.size > buffer.length,
      };
    } finally {
      await handle.close();
    }
  }

  return { ...base, kind: 'unsupported', error: 'No preview for this file type.' };
}
