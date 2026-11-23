/** Pure validation of what JARVIS may ask the Windows browser to open. */

const MAX_URL_LENGTH = 2000;
const MAX_QUERY_LENGTH = 300;
const SEARCH_URL = 'https://duckduckgo.com/?q=';

export interface WebTarget {
  ok: boolean;
  url?: string;
  error?: string;
}

export function isPrivateHost(host: string): boolean {
  const name = host.toLowerCase();
  if (name === 'localhost' || name.endsWith('.localhost') || name.endsWith('.local')) return true;
  if (!name.includes('.') && !name.includes(':')) return true; // single-label intranet names
  if (name.startsWith('[') || name.includes(':')) return true; // IPv6 literals
  const octets = name.split('.').map(Number);
  if (octets.length === 4 && octets.every((n) => Number.isInteger(n) && n >= 0 && n <= 255)) {
    const [a, b] = octets;
    return (
      a === 10 ||
      a === 127 ||
      a === 0 ||
      (a === 169 && b === 254) ||
      (a === 172 && b >= 16 && b <= 31) ||
      (a === 192 && b === 168)
    );
  }
  return false;
}

/** Either an https address or a search phrase. Nothing else ever reaches the browser. */
export function buildWebTarget(input: { url?: unknown; query?: unknown }): WebTarget {
  const hasUrl = typeof input.url === 'string' && input.url.trim() !== '';
  const hasQuery = typeof input.query === 'string' && input.query.trim() !== '';
  if (hasUrl === hasQuery) return { ok: false, error: 'Give either a url or a query, not both.' };

  if (hasQuery) {
    const query = (input.query as string).trim();
    if (query.length > MAX_QUERY_LENGTH) return { ok: false, error: 'That search is too long.' };
    return { ok: true, url: SEARCH_URL + encodeURIComponent(query) };
  }

  const raw = (input.url as string).trim();
  if (raw.length > MAX_URL_LENGTH) return { ok: false, error: 'That address is too long.' };
  let parsed: URL;
  try {
    parsed = new URL(raw);
  } catch {
    return { ok: false, error: 'That is not a valid web address.' };
  }
  if (parsed.protocol !== 'https:')
    return { ok: false, error: 'Only https:// addresses can be opened.' };
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Addresses with a sign-in embedded are not allowed.' };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { ok: false, error: 'Local and private-network addresses are not allowed.' };
  }
  return { ok: true, url: parsed.toString() };
}

/** Shared by the browser opener and the page fetcher: https only, no sign-in, no private hosts. */
export function checkPublicHttpsUrl(raw: string): { ok: boolean; url?: URL; error?: string } {
  if (raw.length > MAX_URL_LENGTH) return { ok: false, error: 'That address is too long.' };
  let parsed: URL;
  try {
    parsed = new URL(raw.trim());
  } catch {
    return { ok: false, error: 'That is not a valid web address.' };
  }
  if (parsed.protocol !== 'https:')
    return { ok: false, error: 'Only https:// addresses are allowed.' };
  if (parsed.username || parsed.password) {
    return { ok: false, error: 'Addresses with a sign-in embedded are not allowed.' };
  }
  if (isPrivateHost(parsed.hostname)) {
    return { ok: false, error: 'Local and private-network addresses are not allowed.' };
  }
  return { ok: true, url: parsed };
}

/** IP-level check used at connection time, so a hostname cannot resolve to a private address. */
export function isPrivateAddress(address: string): boolean {
  const ip = address.toLowerCase();
  if (ip.includes(':')) {
    const mapped = ip.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/);
    if (mapped) return isPrivateAddress(mapped[1]);
    return (
      ip === '::1' ||
      ip === '::' ||
      ip.startsWith('fc') ||
      ip.startsWith('fd') ||
      ip.startsWith('fe80')
    );
  }
  return isPrivateHost(ip);
}
