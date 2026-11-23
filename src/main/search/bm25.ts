import { termVariants, tokenize } from '../../shared/text';

const K1 = 1.5;
const B = 0.75;
/** Query terms this long (or longer) also match tokens that merely start with them. */
const PREFIX_MIN_LENGTH = 3;
const PREFIX_WEIGHT = 0.6;

export interface Bm25Hit {
  id: string;
  score: number;
}

/**
 * In-memory BM25 keyword index. Deliberately simple: exact tokens (plus plural variants and
 * prefixes), no embeddings. Embeddings can be added later behind the same `search` shape.
 */
export class Bm25Index {
  private readonly postings = new Map<string, Map<string, number>>();
  private readonly lengths = new Map<string, number>();
  private readonly docTerms = new Map<string, string[]>();
  private totalLength = 0;

  get size(): number {
    return this.lengths.size;
  }

  has(id: string): boolean {
    return this.lengths.has(id);
  }

  add(id: string, text: string): void {
    if (this.has(id)) this.remove(id);
    const tokens = tokenize(text);
    const counts = new Map<string, number>();
    for (const token of tokens) counts.set(token, (counts.get(token) ?? 0) + 1);
    for (const [term, count] of counts) {
      let posting = this.postings.get(term);
      if (!posting) {
        posting = new Map();
        this.postings.set(term, posting);
      }
      posting.set(id, count);
    }
    this.lengths.set(id, tokens.length);
    this.docTerms.set(id, [...counts.keys()]);
    this.totalLength += tokens.length;
  }

  remove(id: string): void {
    const terms = this.docTerms.get(id);
    if (!terms) return;
    for (const term of terms) {
      const posting = this.postings.get(term);
      if (!posting) continue;
      posting.delete(id);
      if (posting.size === 0) this.postings.delete(term);
    }
    this.totalLength -= this.lengths.get(id) ?? 0;
    this.lengths.delete(id);
    this.docTerms.delete(id);
  }

  clear(): void {
    this.postings.clear();
    this.lengths.clear();
    this.docTerms.clear();
    this.totalLength = 0;
  }

  /** Ranked matches for a free-text query. Documents matching more distinct terms rank higher. */
  search(query: string, limit = 20, accept?: (id: string) => boolean): Bm25Hit[] {
    const terms = [...new Set(tokenize(query))];
    if (terms.length === 0 || this.size === 0) return [];
    const averageLength = this.totalLength / this.size || 1;
    const scores = new Map<string, number>();

    for (const term of terms) {
      const termScores = new Map<string, number>();
      const accumulate = (posting: Map<string, number>, weight: number) => {
        const idf = Math.log(1 + (this.size - posting.size + 0.5) / (posting.size + 0.5));
        for (const [id, frequency] of posting) {
          const length = this.lengths.get(id) ?? 0;
          const normalised =
            (frequency * (K1 + 1)) / (frequency + K1 * (1 - B + B * (length / averageLength)));
          const value = idf * normalised * weight;
          if (value > (termScores.get(id) ?? 0)) termScores.set(id, value);
        }
      };
      for (const variant of termVariants(term)) {
        const posting = this.postings.get(variant);
        if (posting) accumulate(posting, 1);
      }
      if (term.length >= PREFIX_MIN_LENGTH) {
        for (const [indexed, posting] of this.postings) {
          if (indexed !== term && indexed.startsWith(term)) accumulate(posting, PREFIX_WEIGHT);
        }
      }
      for (const [id, value] of termScores) scores.set(id, (scores.get(id) ?? 0) + value);
    }

    const hits: Bm25Hit[] = [];
    for (const [id, score] of scores) {
      if (accept && !accept(id)) continue;
      hits.push({ id, score });
    }
    hits.sort((a, b) => b.score - a.score);
    return hits.slice(0, limit);
  }
}
