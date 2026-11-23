/** Pure helpers that turn fetched web content into plain text. Nothing here touches the network. */

const ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  rsquo: '’',
  lsquo: '‘',
  rdquo: '”',
  ldquo: '“',
  ndash: '–',
  mdash: '—',
  hellip: '…',
};

export function decodeEntities(text: string): string {
  return text
    .replace(/&#x([0-9a-f]+);/gi, (_m, hex: string) => safeChar(parseInt(hex, 16)))
    .replace(/&#(\d+);/g, (_m, dec: string) => safeChar(parseInt(dec, 10)))
    .replace(/&([a-z]+);/gi, (match, name: string) => ENTITIES[name.toLowerCase()] ?? match);
}

function safeChar(code: number): string {
  return Number.isFinite(code) && code > 0 && code < 0x110000 ? String.fromCodePoint(code) : '';
}

/** Strip scripts, styles and tags; keep readable paragraph breaks. */
export function htmlToText(html: string, maxChars = 20_000): string {
  const text = decodeEntities(
    html
      .replace(/<!--[\s\S]*?-->/g, ' ')
      .replace(/<(script|style|noscript|svg|head|template)[\s\S]*?<\/\1>/gi, ' ')
      .replace(/<\/(p|div|li|tr|h[1-6]|section|article|br)>/gi, '\n')
      .replace(/<br\s*\/?>/gi, '\n')
      .replace(/<[^>]+>/g, ' '),
  )
    .replace(/[ \t\f\v]+/g, ' ')
    .replace(/ *\n */g, '\n')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
  return text.length > maxChars ? `${text.slice(0, maxChars)}…` : text;
}

export interface FeedItem {
  title: string;
  link: string;
  published: string;
}

function tagText(block: string, tag: string): string {
  const match = block.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'i'));
  if (!match) return '';
  return decodeEntities(
    match[1].replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]+>/g, ''),
  )
    .replace(/\s+/g, ' ')
    .trim();
}

/** RSS or Atom headlines. Titles only: the body of a feed item is never passed on. */
export function parseFeed(xml: string, limit = 8): FeedItem[] {
  const blocks = [...xml.matchAll(/<(item|entry)[\s>][\s\S]*?<\/\1>/gi)].map((m) => m[0]);
  const items: FeedItem[] = [];
  for (const block of blocks) {
    const title = tagText(block, 'title');
    if (!title) continue;
    const linkTag = block.match(/<link[^>]*href="([^"]+)"/i);
    const link = linkTag ? linkTag[1] : tagText(block, 'link');
    const published =
      tagText(block, 'pubDate') || tagText(block, 'updated') || tagText(block, 'published');
    items.push({ title: title.slice(0, 200), link: link.slice(0, 500), published });
    if (items.length >= limit) break;
  }
  return items;
}

export interface SearchHit {
  title: string;
  url: string;
  snippet: string;
}

/** Results page of DuckDuckGo's plain HTML endpoint. Best effort: the layout can change. */
export function parseSearchResults(html: string, limit = 6): SearchHit[] {
  const hits: SearchHit[] = [];
  const pattern =
    /<a[^>]+class="result__a"[^>]+href="([^"]+)"[^>]*>([\s\S]*?)<\/a>[\s\S]*?(?:class="result__snippet"[^>]*>([\s\S]*?)<\/a>)?/gi;
  for (const match of html.matchAll(pattern)) {
    let url = decodeEntities(match[1]);
    const redirect = url.match(/[?&]uddg=([^&]+)/);
    if (redirect) {
      try {
        url = decodeURIComponent(redirect[1]);
      } catch {
        continue;
      }
    }
    if (!/^https:\/\//i.test(url)) continue;
    const title = decodeEntities((match[2] ?? '').replace(/<[^>]+>/g, '')).trim();
    const snippet = decodeEntities((match[3] ?? '').replace(/<[^>]+>/g, '')).trim();
    if (!title) continue;
    hits.push({
      title: title.slice(0, 160),
      url: url.slice(0, 500),
      snippet: snippet.slice(0, 300),
    });
    if (hits.length >= limit) break;
  }
  return hits;
}

/** Stable fingerprint of a page's text for change monitoring (ignores whitespace and case). */
export function normalizeForCompare(text: string): string {
  return text.replace(/\s+/g, ' ').trim().toLowerCase();
}
