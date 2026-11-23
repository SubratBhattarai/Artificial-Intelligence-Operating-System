import { describe, expect, it } from 'vitest';
import { Bm25Index } from '../src/main/search/bm25';
import { makeSnippet, queryTerms, splitHighlight, tokenize } from '../src/shared/text';

describe('tokenize', () => {
  it('lowercases, splits on punctuation and drops stopwords', () => {
    expect(tokenize('The Quick, brown fox!')).toEqual(['quick', 'brown', 'fox']);
    expect(queryTerms('fox fox FOX')).toEqual(['fox']);
  });
});

describe('Bm25Index', () => {
  it('ranks documents with more query terms and rarer terms higher', () => {
    const index = new Bm25Index();
    index.add('a', 'budget report for the robotics club');
    index.add('b', 'club picnic schedule');
    index.add('c', 'unrelated cooking notes');
    const hits = index.search('robotics club budget');
    expect(hits[0].id).toBe('a');
    expect(hits.map((hit) => hit.id)).toContain('b');
    expect(hits.map((hit) => hit.id)).not.toContain('c');
  });

  it('supports removal and replacement', () => {
    const index = new Bm25Index();
    index.add('a', 'apple banana');
    index.add('a', 'cherry only');
    expect(index.search('banana')).toHaveLength(0);
    expect(index.search('cherry')).toHaveLength(1);
    index.remove('a');
    expect(index.size).toBe(0);
    expect(index.search('cherry')).toHaveLength(0);
  });

  it('matches plural variants and prefixes', () => {
    const index = new Bm25Index();
    index.add('a', 'a quarterly policy document');
    expect(index.search('policies')).toHaveLength(1);
    expect(index.search('quart')).toHaveLength(1);
  });

  it('honours an accept filter', () => {
    const index = new Bm25Index();
    index.add('keep:1', 'shared word');
    index.add('drop:1', 'shared word');
    const hits = index.search('shared', 10, (id) => id.startsWith('keep'));
    expect(hits.map((hit) => hit.id)).toEqual(['keep:1']);
  });
});

describe('snippets and highlighting', () => {
  it('centres the snippet on the first match', () => {
    const text = `${'filler '.repeat(60)}the needle is here ${'tail '.repeat(60)}`;
    const snippet = makeSnippet(text, 'needle', 120);
    expect(snippet).toContain('needle');
    expect(snippet.startsWith('…')).toBe(true);
    expect(snippet.length).toBeLessThanOrEqual(130);
  });

  it('flags matching parts for highlighting', () => {
    const parts = splitHighlight('Budget and budgets', ['budget']);
    expect(parts.filter((part) => part.hit).map((part) => part.text)).toEqual(['Budget', 'budget']);
  });
});
