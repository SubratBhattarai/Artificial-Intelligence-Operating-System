import { randomUUID } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import { MAX_CREATE_BYTES, MAX_EDIT_BYTES, checkFileName, resolveWritable } from '../fs/safeWrite';
import type { Tool } from './types';

function clip(text: string, max: number): string {
  return text.length > max ? `${text.slice(0, max)}…` : text;
}

async function readIfSmall(file: string): Promise<string> {
  const stats = await fs.stat(file);
  if (stats.size > MAX_EDIT_BYTES) throw new Error('That file is too large to edit.');
  return fs.readFile(file, 'utf8');
}

export function createCreateFileTool(): Tool<{ path: string; content: string }, { path: string }> {
  return {
    name: 'create_file',
    description:
      'Create a NEW text file inside an allowed folder (it never overwrites). The user sees the path and content and must approve.',
    riskTier: 'medium',
    permissions: ['files:write'],
    sensitiveArgs: ['content'],
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 1000 },
        content: { type: 'string', maxLength: MAX_CREATE_BYTES },
      },
      required: ['path', 'content'],
      additionalProperties: false,
    },
    preview: (params) => ({
      title: 'Create a file',
      lines: [params.path, clip(params.content, 500) || '(empty file)'],
    }),
    async execute(params) {
      const nameProblem = checkFileName(params.path);
      if (nameProblem) throw new Error(nameProblem);
      const target = await resolveWritable(params.path);
      if (target.exists)
        throw new Error('A file with that name already exists; nothing was changed.');
      await fs.writeFile(target.real, params.content, { encoding: 'utf8', flag: 'wx' });
      return { path: target.real };
    },
    async verify(params, result) {
      const text = await fs.readFile(result.path, 'utf8').catch(() => null);
      return text === params.content
        ? { ok: true, detail: `Created ${path.basename(result.path)}.` }
        : { ok: false, detail: 'The file was not found, or differs, when read back.' };
    },
    async rollback(_params, result) {
      await fs.unlink(result.path).catch(() => undefined);
    },
  };
}

export function createMoveFileTool(): Tool<
  { from: string; to: string },
  { from: string; to: string }
> {
  return {
    name: 'move_file',
    description:
      'Move or rename one file between allowed folders. It never overwrites an existing file. The user must approve.',
    riskTier: 'medium',
    permissions: ['files:write'],
    parameters: {
      type: 'object',
      properties: {
        from: { type: 'string', minLength: 1, maxLength: 1000 },
        to: { type: 'string', minLength: 1, maxLength: 1000 },
      },
      required: ['from', 'to'],
      additionalProperties: false,
    },
    preview: (params) => ({
      title: 'Move a file',
      lines: [`From: ${params.from}`, `To: ${params.to}`],
    }),
    async execute(params) {
      const nameProblem = checkFileName(params.to) ?? checkFileName(params.from);
      if (nameProblem) throw new Error(nameProblem);
      const source = await resolveWritable(params.from);
      if (!source.exists) throw new Error('The file to move was not found.');
      const stats = await fs.stat(source.real);
      if (!stats.isFile()) throw new Error('Only single files can be moved.');
      const destination = await resolveWritable(params.to);
      if (destination.exists)
        throw new Error('Something already exists at the destination; nothing was moved.');
      await fs.rename(source.real, destination.real);
      return { from: source.real, to: destination.real };
    },
    async verify(_params, result) {
      const moved = await fs.stat(result.to).then(
        () => true,
        () => false,
      );
      const gone = await fs.stat(result.from).then(
        () => false,
        () => true,
      );
      return moved && gone
        ? { ok: true, detail: `Moved to ${result.to}.` }
        : { ok: false, detail: 'The file is not where it should be after the move.' };
    },
    async rollback(_params, result) {
      await fs.rename(result.to, result.from).catch(() => undefined);
    },
  };
}

/** Previous contents kept in memory only, so a failed edit can be undone without logging file text. */
const undoBuffers = new Map<string, string>();

function remember(previous: string): string {
  const token = randomUUID();
  undoBuffers.set(token, previous);
  if (undoBuffers.size > 20) undoBuffers.delete(undoBuffers.keys().next().value as string);
  return token;
}

export function createEditFileTool(): Tool<
  { path: string; find: string; replace: string },
  { path: string; token: string }
> {
  return {
    name: 'edit_file',
    description:
      'Edit an existing text file in an allowed folder by replacing ONE exact piece of text that appears exactly once. The user sees the before and after and must approve.',
    riskTier: 'medium',
    permissions: ['files:write'],
    sensitiveArgs: ['find', 'replace'],
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 1000 },
        find: { type: 'string', minLength: 1, maxLength: 5000 },
        replace: { type: 'string', maxLength: 20000 },
      },
      required: ['path', 'find', 'replace'],
      additionalProperties: false,
    },
    preview: (params) => ({
      title: 'Edit a file',
      lines: [
        params.path,
        `Replace: ${clip(params.find, 300)}`,
        `With: ${clip(params.replace, 300) || '(nothing)'}`,
      ],
    }),
    async execute(params) {
      const nameProblem = checkFileName(params.path);
      if (nameProblem) throw new Error(nameProblem);
      const target = await resolveWritable(params.path);
      if (!target.exists) throw new Error('That file does not exist.');
      const before = await readIfSmall(target.real);
      const first = before.indexOf(params.find);
      if (first < 0) throw new Error('The text to replace was not found; nothing was changed.');
      if (before.indexOf(params.find, first + 1) >= 0) {
        throw new Error('That text appears more than once; give a longer, unique piece of text.');
      }
      const token = remember(before);
      const after =
        before.slice(0, first) + params.replace + before.slice(first + params.find.length);
      await fs.writeFile(target.real, after, 'utf8');
      return { path: target.real, token };
    },
    async verify(params, result) {
      const now = await fs.readFile(result.path, 'utf8').catch(() => '');
      return now.includes(params.replace)
        ? { ok: true, detail: 'The edit is in the file.' }
        : { ok: false, detail: 'The edit was not found in the file when read back.' };
    },
    async rollback(_params, result) {
      const previous = undoBuffers.get(result.token);
      if (previous !== undefined)
        await fs.writeFile(result.path, previous, 'utf8').catch(() => undefined);
    },
  };
}

export function createAppendToFileTool(): Tool<
  { path: string; text: string },
  { path: string; token: string }
> {
  return {
    name: 'append_to_file',
    description:
      'Add text to the end of an existing text file in an allowed folder. The user sees the text and must approve.',
    riskTier: 'medium',
    permissions: ['files:write'],
    sensitiveArgs: ['text'],
    parameters: {
      type: 'object',
      properties: {
        path: { type: 'string', minLength: 1, maxLength: 1000 },
        text: { type: 'string', minLength: 1, maxLength: 20000 },
      },
      required: ['path', 'text'],
      additionalProperties: false,
    },
    preview: (params) => ({ title: 'Add to a file', lines: [params.path, clip(params.text, 500)] }),
    async execute(params) {
      const nameProblem = checkFileName(params.path);
      if (nameProblem) throw new Error(nameProblem);
      const target = await resolveWritable(params.path);
      if (!target.exists) throw new Error('That file does not exist.');
      const before = await readIfSmall(target.real);
      const token = remember(before);
      await fs.writeFile(target.real, before + params.text, 'utf8');
      return { path: target.real, token };
    },
    async verify(params, result) {
      const now = await fs.readFile(result.path, 'utf8').catch(() => '');
      return now.endsWith(params.text)
        ? { ok: true, detail: 'The text was added.' }
        : { ok: false, detail: 'The added text was not found at the end of the file.' };
    },
    async rollback(_params, result) {
      const previous = undoBuffers.get(result.token);
      if (previous !== undefined)
        await fs.writeFile(result.path, previous, 'utf8').catch(() => undefined);
    },
  };
}
