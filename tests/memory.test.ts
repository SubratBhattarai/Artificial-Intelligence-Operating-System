import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { flushAllJsonFiles } from '../src/main/store/jsonFile';
import { ConversationStore } from '../src/main/memory/conversationStore';
import { MemoryStore } from '../src/main/memory/memoryStore';
import { NoteStore } from '../src/main/memory/noteStore';
import { searchAll } from '../src/main/memory/searchAll';

const DAY = 24 * 60 * 60 * 1000;
const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-test-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  flushAllJsonFiles();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

describe('MemoryStore', () => {
  it('stores facts with source, dates, confidence and expiry', () => {
    const store = new MemoryStore(tempDir());
    const record = store.add({ fact: 'Prefers dark mode', confidence: 0.9 }, { now: 1000 });
    expect(record.fact).toBe('Prefers dark mode');
    expect(record.source.kind).toBe('manual');
    expect(record.createdAt).toBe(1000);
    expect(record.confidence).toBe(0.9);
    expect(record.expiresAt).toBeNull();
    expect(record.status).toBe('active');
  });

  it('rejects empty or oversized facts and past expiry dates', () => {
    const store = new MemoryStore(tempDir());
    expect(() => store.add({ fact: '   ' })).toThrow();
    expect(() => store.add({ fact: 'x'.repeat(501) })).toThrow();
    expect(() => store.add({ fact: 'ok', expiresAt: Date.now() - 1000 })).toThrow();
  });

  it('does not duplicate the same fact', () => {
    const store = new MemoryStore(tempDir());
    const first = store.add({ fact: 'Lives in Iowa' });
    const second = store.add({ fact: 'lives in iowa' });
    expect(second.id).toBe(first.id);
    expect(store.list()).toHaveLength(1);
  });

  it('hides expired facts and purges them on request', () => {
    const store = new MemoryStore(tempDir());
    store.add({ fact: 'Temporary', expiresAt: 5000 }, { now: 1000 });
    store.add({ fact: 'Lasting' }, { now: 1000 });
    expect(store.list({ now: 6000 })).toHaveLength(1);
    expect(store.list({ now: 6000, includeExpired: true })).toHaveLength(2);
    expect(store.promptFacts(6000)).toEqual(['Lasting']);
    expect(store.purgeExpired(6000)).toBe(1);
    expect(store.list({ includeExpired: true, now: 6000 })).toHaveLength(1);
  });

  it('keeps suggestions out of the prompt until approved', () => {
    const store = new MemoryStore(tempDir());
    const suggestion = store.add(
      { fact: 'Likes Python' },
      {
        status: 'pending',
        source: { kind: 'suggested', sessionId: 's1', label: 'Suggested by JARVIS' },
      },
    );
    expect(store.promptFacts()).toEqual([]);
    store.approve(suggestion.id);
    expect(store.promptFacts()).toEqual(['Likes Python']);
  });

  it('deletes by source without touching other sources', () => {
    const store = new MemoryStore(tempDir());
    store.add({ fact: 'Manual one' });
    store.add(
      { fact: 'From chat A' },
      { source: { kind: 'conversation', sessionId: 'a', label: 'A' } },
    );
    store.add(
      { fact: 'From chat A too' },
      { source: { kind: 'conversation', sessionId: 'a', label: 'A' } },
    );
    const sources = store.sources();
    const chatA = sources.find((source) => source.sessionId === 'a');
    expect(chatA?.count).toBe(2);
    expect(store.removeBySource(chatA!.key)).toBe(2);
    expect(store.list().map((record) => record.fact)).toEqual(['Manual one']);
  });

  it('edits a fact and updates its timestamp', () => {
    const store = new MemoryStore(tempDir());
    const record = store.add({ fact: 'Old' }, { now: 1000 });
    const updated = store.update(record.id, { fact: 'New', confidence: 0.5 }, 2000);
    expect(updated.fact).toBe('New');
    expect(updated.updatedAt).toBe(2000);
    expect(updated.createdAt).toBe(1000);
  });

  it('persists across restarts', () => {
    const dir = tempDir();
    const first = new MemoryStore(dir);
    first.add({ fact: 'Survives restart' });
    first.setSettings({ injectIntoPrompt: false });
    first.flush();
    const second = new MemoryStore(dir);
    expect(second.list().map((record) => record.fact)).toEqual(['Survives restart']);
    expect(second.getSettings().injectIntoPrompt).toBe(false);
  });

  it('quarantines a corrupt file instead of overwriting it', () => {
    const dir = tempDir();
    fs.writeFileSync(path.join(dir, 'memory.json'), '{not json');
    const store = new MemoryStore(dir);
    expect(store.list()).toHaveLength(0);
    expect(fs.readdirSync(dir).some((name) => name.includes('.corrupt-'))).toBe(true);
  });
});

describe('ConversationStore', () => {
  it('records turns with session id and timestamps, and summarizes', () => {
    const store = new ConversationStore(tempDir());
    store.recordTurn(
      'session-1',
      'How do I reset my router?',
      'Hold the reset button. Then wait.',
      1000,
    );
    const conversation = store.recordTurn(
      'session-1',
      'And the password?',
      'It is on the label.',
      5000,
    );
    expect(conversation.messages).toHaveLength(4);
    expect(conversation.createdAt).toBe(1000);
    expect(conversation.updatedAt).toBe(5000);
    expect(conversation.title).toBe('How do I reset my router?');
    expect(conversation.summary).toContain('Latest: And the password?');
    expect(store.list()).toHaveLength(1);
  });

  it('rejects unsafe session ids', () => {
    const store = new ConversationStore(tempDir());
    expect(() => store.recordTurn('../evil', 'a', 'b')).toThrow();
  });

  it('removes one conversation', () => {
    const store = new ConversationStore(tempDir());
    store.recordTurn('s1', 'one', 'a');
    store.recordTurn('s2', 'two', 'b');
    expect(store.remove('s1')).toBe(true);
    expect(store.list().map((entry) => entry.id)).toEqual(['s2']);
  });
});

describe('searchAll', () => {
  it('finds memory, notes and conversations by keyword', () => {
    const dir = tempDir();
    const memory = new MemoryStore(dir);
    const notes = new NoteStore(dir);
    const conversations = new ConversationStore(dir);
    memory.add({ fact: 'My passport renewal is due in March' });
    notes.create('Groceries\nbananas and oatmeal');
    conversations.recordTurn('chat-1', 'Plan my passport appointment', 'Book it online.');

    const hits = searchAll({ memory, notes, conversations }, 'passport');
    expect(hits.map((hit) => hit.kind).sort()).toEqual(['conversation', 'memory']);
    const noteHits = searchAll({ memory, notes, conversations }, 'oatmeal');
    expect(noteHits).toHaveLength(1);
    expect(noteHits[0].kind).toBe('note');
    expect(
      searchAll({ memory, notes, conversations }, 'passport', { kinds: ['memory'] }),
    ).toHaveLength(1);
    expect(searchAll({ memory, notes, conversations }, 'zzzz')).toHaveLength(0);
  });

  it('matches plurals and prefixes', () => {
    const dir = tempDir();
    const memory = new MemoryStore(dir);
    memory.add({ fact: 'I keep spreadsheets for budgets' });
    const sources = {
      memory,
      notes: new NoteStore(dir),
      conversations: new ConversationStore(dir),
    };
    expect(searchAll(sources, 'spreadsheet')).toHaveLength(1);
    expect(searchAll(sources, 'budg')).toHaveLength(1);
  });
});

describe('NoteStore', () => {
  it('derives titles, edits and deletes', () => {
    const store = new NoteStore(tempDir());
    const note = store.create('# Trip ideas\nLisbon');
    expect(note.title).toBe('Trip ideas');
    const edited = store.update(note.id, 'Packing list\nsocks');
    expect(edited.title).toBe('Packing list');
    expect(store.remove(note.id)).toBe(true);
    expect(store.list()).toHaveLength(0);
    expect(DAY).toBeGreaterThan(0);
  });
});
