/**
 * Pure text helpers shared by the main process (indexing/search) and the renderer (highlighting).
 * No Node or Electron imports.
 */

const STOPWORDS = new Set([
  'the',
  'and',
  'for',
  'are',
  'was',
  'were',
  'but',
  'not',
  'you',
  'your',
  'with',
  'that',
  'this',
  'from',
  'have',
  'has',
  'had',
  'what',
  'when',
  'where',
  'which',
  'who',
  'how',
  'can',
  'will',
  'would',
  'could',
  'should',
  'its',
  'into',
  'about',
  'there',
  'their',
  'them',
  'then',
  'than',
  'any',
  'all',
  'out',
  'our',
  'his',
  'her',
  'she',
  'him',
  'does',
  'did',
  'is',
  'in',
  'on',
  'of',
  'to',
  'a',
  'an',
  'it',
  'as',
  'at',
  'be',
  'by',
  'or',
  'if',
  'so',
  'do',
  'we',
  'i',
  'me',
  'my',
]);

/** Lowercased word tokens (unicode aware), stopwords and 1-letter tokens removed. */
export function tokenize(text: string): string[] {
  return text
    .toLowerCase()
    .split(/[^\p{L}\p{N}]+/u)
    .filter((token) => token.length >= 2 && !STOPWORDS.has(token));
}

/** Unique query terms in order of appearance. */
export function queryTerms(query: string): string[] {
  return [...new Set(tokenize(query))];
}

/** Light plural/ending variants so "files" finds "file" and "policies" finds "policy". */
export function termVariants(term: string): string[] {
  const variants = new Set([term]);
  if (term.length > 3 && term.endsWith('ies')) variants.add(`${term.slice(0, -3)}y`);
  if (term.length > 3 && term.endsWith('es')) variants.add(term.slice(0, -2));
  if (term.length > 3 && term.endsWith('s')) variants.add(term.slice(0, -1));
  return [...variants];
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface HighlightPart {
  text: string;
  hit: boolean;
}

/** Split text into parts, flagging the parts that match any query term (for <mark> rendering). */
export function splitHighlight(text: string, terms: string[]): HighlightPart[] {
  const usable = terms
    .flatMap(termVariants)
    .filter((term) => term.length >= 2)
    .sort((a, b) => b.length - a.length);
  if (usable.length === 0 || text.length === 0) return [{ text, hit: false }];
  const pattern = new RegExp(`(${usable.map(escapeRegExp).join('|')})`, 'giu');
  const parts: HighlightPart[] = [];
  let lastIndex = 0;
  for (const match of text.matchAll(pattern)) {
    const index = match.index ?? 0;
    if (index > lastIndex) parts.push({ text: text.slice(lastIndex, index), hit: false });
    parts.push({ text: match[0], hit: true });
    lastIndex = index + match[0].length;
  }
  if (lastIndex < text.length) parts.push({ text: text.slice(lastIndex), hit: false });
  return parts.length > 0 ? parts : [{ text, hit: false }];
}

/** A short window of `text` around the first query-term match, whitespace collapsed. */
export function makeSnippet(text: string, query: string, maxLength = 240): string {
  const flat = text.replace(/\s+/g, ' ').trim();
  if (flat.length <= maxLength) return flat;
  const lower = flat.toLowerCase();
  let anchor = -1;
  for (const term of queryTerms(query).flatMap(termVariants)) {
    const index = lower.indexOf(term);
    if (index >= 0 && (anchor < 0 || index < anchor)) anchor = index;
  }
  if (anchor < 0) return `${flat.slice(0, maxLength).trimEnd()}…`;
  const start = Math.max(0, anchor - Math.floor(maxLength / 3));
  const end = Math.min(flat.length, start + maxLength);
  const body = flat.slice(start, end).trim();
  return `${start > 0 ? '…' : ''}${body}${end < flat.length ? '…' : ''}`;
}
