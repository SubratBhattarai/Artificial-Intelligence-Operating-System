import type { SearchHit, SearchHitKind } from '../../shared/protocol';
import { makeSnippet } from '../../shared/text';
import { Bm25Index } from '../search/bm25';
import type { ConversationStore } from './conversationStore';
import type { MemoryStore } from './memoryStore';
import type { NoteStore } from './noteStore';

export interface SearchSources {
  memory: MemoryStore;
  notes: NoteStore;
  conversations: ConversationStore;
}

interface Doc {
  kind: SearchHitKind;
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

/**
 * Keyword search across memory facts, saved notes and conversations (titles, summaries and
 * transcripts). The corpus is small and local, so the index is rebuilt per query: always fresh,
 * nothing to keep in sync.
 */
export function searchAll(
  sources: SearchSources,
  query: string,
  options: { kinds?: SearchHitKind[]; limit?: number } = {},
): SearchHit[] {
  const wanted = new Set<SearchHitKind>(options.kinds ?? ['memory', 'note', 'conversation']);
  const docs = new Map<string, Doc>();

  if (wanted.has('memory')) {
    for (const record of sources.memory.list({ status: 'active' })) {
      docs.set(`memory:${record.id}`, {
        kind: 'memory',
        id: record.id,
        title: record.fact.slice(0, 80),
        body: record.fact,
        createdAt: record.createdAt,
        updatedAt: record.updatedAt,
      });
    }
  }
  if (wanted.has('note')) {
    for (const note of sources.notes.list()) {
      docs.set(`note:${note.id}`, {
        kind: 'note',
        id: note.id,
        title: note.title,
        body: `${note.title}\n${note.body}`,
        createdAt: note.createdAt,
        updatedAt: note.updatedAt,
      });
    }
  }
  if (wanted.has('conversation')) {
    for (const conversation of sources.conversations.all()) {
      docs.set(`conversation:${conversation.id}`, {
        kind: 'conversation',
        id: conversation.id,
        title: conversation.title,
        body: [
          conversation.title,
          conversation.summary,
          ...conversation.messages.map((message) => message.content),
        ].join('\n'),
        createdAt: conversation.createdAt,
        updatedAt: conversation.updatedAt,
      });
    }
  }

  const index = new Bm25Index();
  for (const [key, doc] of docs) index.add(key, doc.body);

  return index.search(query, options.limit ?? 30).flatMap((hit) => {
    const doc = docs.get(hit.id);
    if (!doc) return [];
    return [
      {
        kind: doc.kind,
        id: doc.id,
        title: doc.title,
        snippet: makeSnippet(doc.body, query),
        score: Math.round(hit.score * 100) / 100,
        createdAt: doc.createdAt,
        updatedAt: doc.updatedAt,
      },
    ];
  });
}
