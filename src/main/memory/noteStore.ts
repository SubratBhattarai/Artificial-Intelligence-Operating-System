import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { NoteRecord } from '../../shared/protocol';
import { JsonFile } from '../store/jsonFile';

const MAX_NOTES = 500;
const MAX_TITLE_LENGTH = 120;
const MAX_BODY_LENGTH = 200_000;

interface NoteData {
  version: 1;
  notes: NoteRecord[];
}

function deriveTitle(body: string): string {
  const firstLine = body.split('\n').find((line) => line.trim().length > 0) ?? '';
  return (
    firstLine
      .replace(/^#+\s*/, '')
      .trim()
      .slice(0, MAX_TITLE_LENGTH) || 'Untitled note'
  );
}

/** Saved notes, stored locally and searchable alongside memory and conversations. */
export class NoteStore {
  private readonly file: JsonFile<NoteData>;

  constructor(dataDir: string) {
    this.file = new JsonFile<NoteData>(
      path.join(dataDir, 'notes.json'),
      () => ({ version: 1, notes: [] }),
      (raw) => {
        const data = raw as Partial<NoteData> | null;
        if (!data || !Array.isArray(data.notes)) return null;
        return {
          version: 1,
          notes: data.notes.filter(
            (note): note is NoteRecord =>
              !!note && typeof note.id === 'string' && typeof note.body === 'string',
          ),
        };
      },
    );
  }

  private get notes(): NoteRecord[] {
    return this.file.value.notes;
  }

  list(): NoteRecord[] {
    return [...this.notes].sort((a, b) => b.updatedAt - a.updatedAt).map((note) => ({ ...note }));
  }

  get(id: string): NoteRecord | null {
    const note = this.notes.find((entry) => entry.id === id);
    return note ? { ...note } : null;
  }

  create(body = '', now = Date.now()): NoteRecord {
    if (this.notes.length >= MAX_NOTES) throw new Error(`Notes are limited to ${MAX_NOTES}.`);
    const text = String(body).slice(0, MAX_BODY_LENGTH);
    const note: NoteRecord = {
      id: randomUUID(),
      title: deriveTitle(text),
      body: text,
      createdAt: now,
      updatedAt: now,
    };
    this.notes.push(note);
    this.file.touch();
    return { ...note };
  }

  update(id: string, body: string, now = Date.now()): NoteRecord {
    const note = this.notes.find((entry) => entry.id === id);
    if (!note) throw new Error('That note no longer exists.');
    note.body = String(body).slice(0, MAX_BODY_LENGTH);
    note.title = deriveTitle(note.body);
    note.updatedAt = now;
    this.file.touch();
    return { ...note };
  }

  remove(id: string): boolean {
    const index = this.notes.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    this.notes.splice(index, 1);
    this.file.touch();
    return true;
  }

  clearAll(): number {
    const removed = this.notes.length;
    this.file.value.notes = [];
    this.file.touch();
    return removed;
  }

  flush(): void {
    this.file.flushSync();
  }
}
