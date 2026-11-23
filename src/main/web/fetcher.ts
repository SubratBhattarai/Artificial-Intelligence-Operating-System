import dns from 'node:dns';
import https from 'node:https';
import net from 'node:net';
import { checkPublicHttpsUrl, isPrivateAddress } from '../tools/webTarget';
import { htmlToText } from './text';

export const MAX_FETCH_BYTES = 600_000;
export const FETCH_TIMEOUT_MS = 12_000;
const MAX_REDIRECTS = 3;

export interface FetchedPage {
  url: string;
  status: number;
  contentType: string;
  /** Raw body text (HTML/XML/JSON), size-capped. */
  body: string;
}

/**
 * Connection-time check: whichever address the name resolves to is the one used, and a private
 * address is refused. This closes the "public name, private address" trick that URL checks miss.
 */
const safeLookup: net.LookupFunction = (hostname, options, callback) => {
  dns.lookup(hostname, { ...options, all: true }, (error, addresses) => {
    if (error) {
      (callback as (e: Error | null, address: string, family: number) => void)(error, '', 4);
      return;
    }
    const list = Array.isArray(addresses) ? addresses : [];
    const bad = list.find((entry) => isPrivateAddress(entry.address));
    if (bad || list.length === 0) {
      (callback as (e: Error | null, address: string, family: number) => void)(
        new Error('That address points to a private network.'),
        '',
        4,
      );
      return;
    }
    if ((options as { all?: boolean }).all) {
      (callback as unknown as (e: null, a: dns.LookupAddress[]) => void)(null, list);
    } else {
      callback(null, list[0].address, list[0].family);
    }
  });
};

function fetchOnce(
  url: URL,
  signal: AbortSignal | undefined,
  accept: string,
): Promise<{ status: number; headers: Record<string, string>; body: string; location?: string }> {
  return new Promise((resolve, reject) => {
    const request = https.get(
      url,
      {
        lookup: safeLookup,
        timeout: FETCH_TIMEOUT_MS,
        headers: {
          'user-agent': 'Mozilla/5.0 (compatible; AI-OS/1.0)',
          accept,
          'accept-encoding': 'identity',
        },
        signal,
      },
      (response) => {
        const chunks: Buffer[] = [];
        let size = 0;
        response.on('data', (chunk: Buffer) => {
          size += chunk.length;
          if (size > MAX_FETCH_BYTES) {
            response.destroy();
            return;
          }
          chunks.push(chunk);
        });
        const finish = () =>
          resolve({
            status: response.statusCode ?? 0,
            headers: Object.fromEntries(
              Object.entries(response.headers).map(([k, v]) => [k, String(v ?? '')]),
            ),
            body: Buffer.concat(chunks).toString('utf8'),
            location: response.headers.location,
          });
        response.on('end', finish);
        response.on('close', finish);
        response.on('error', reject);
      },
    );
    request.on('timeout', () =>
      request.destroy(new Error('The website took too long to respond.')),
    );
    request.on('error', reject);
  });
}

/** Fetch a public https page as text. Redirects are followed manually and re-checked every hop. */
export async function fetchPage(
  rawUrl: string,
  options: { signal?: AbortSignal; accept?: string } = {},
): Promise<FetchedPage> {
  let current = rawUrl;
  for (let hop = 0; hop <= MAX_REDIRECTS; hop += 1) {
    const checked = checkPublicHttpsUrl(current);
    if (!checked.ok || !checked.url) throw new Error(checked.error ?? 'Address not allowed.');
    const result = await fetchOnce(
      checked.url,
      options.signal,
      options.accept ??
        'text/html,application/xhtml+xml,application/xml,application/json,text/plain',
    );
    if (result.status >= 300 && result.status < 400 && result.location) {
      current = new URL(result.location, checked.url).toString();
      continue;
    }
    const contentType = result.headers['content-type'] ?? '';
    if (!/(text\/|json|xml)/i.test(contentType)) {
      throw new Error('That address is not a text page.');
    }
    return { url: checked.url.toString(), status: result.status, contentType, body: result.body };
  }
  throw new Error('Too many redirects.');
}

/** A page as readable text, for the model (always treated as untrusted by callers). */
export async function fetchReadableText(
  rawUrl: string,
  options: { signal?: AbortSignal; maxChars?: number } = {},
): Promise<{ url: string; text: string }> {
  const page = await fetchPage(rawUrl, options);
  const text = /html/i.test(page.contentType)
    ? htmlToText(page.body, options.maxChars)
    : page.body.slice(0, options.maxChars ?? 20_000);
  return { url: page.url, text };
}
