import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ImportResult } from '../../shared/apps';
import type { MailFolder, MailInput, MailMessage } from '../../shared/mail';
import { JsonFile } from '../store/jsonFile';

const MAX_MESSAGES = 2000;
const MAX_BODY = 20_000;

interface MailData {
  version: 1;
  messages: MailMessage[];
}

function clean(value: unknown, max: number): string {
  return String(value ?? '')
    .replace(/\0/g, '')
    .trim()
    .slice(0, max);
}

/** Pull plain text out of an .eml or .txt file: headers first, then the body. */
export function parseMessageFile(text: string): {
  from: string;
  to: string;
  subject: string;
  date: number;
  body: string;
} {
  const normalised = text.replace(/\r\n/g, '\n');
  const split = normalised.indexOf('\n\n');
  const headerBlock = split >= 0 ? normalised.slice(0, split) : '';
  const rest = split >= 0 ? normalised.slice(split + 2) : normalised;
  const unfolded = headerBlock.replace(/\n[ \t]+/g, ' ');
  const header = (name: string) =>
    new RegExp(`^${name}:\\s*(.*)$`, 'im').exec(unfolded)?.[1]?.trim() ?? '';
  const hasHeaders = /^(from|subject|date|to):/im.test(unfolded);
  let body = hasHeaders ? rest : normalised;
  // Keep only the readable text: drop tags from simple HTML mail.
  if (/<\/?(html|body|div|p|br)\b/i.test(body)) {
    body = body
      .replace(/<style[\s\S]*?<\/style>/gi, '')
      .replace(/<script[\s\S]*?<\/script>/gi, '')
      .replace(/<br\s*\/?>|<\/p>|<\/div>/gi, '\n')
      .replace(/<[^>]+>/g, '')
      .replace(/&nbsp;/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>');
  }
  const parsedDate = Date.parse(header('date'));
  return {
    from: header('from') || 'Unknown sender',
    to: header('to'),
    subject: header('subject') || '(no subject)',
    date: Number.isFinite(parsedDate) ? parsedDate : Date.now(),
    body: body.trim(),
  };
}

export class MailStore {
  private readonly file: JsonFile<MailData>;

  constructor(dataDir: string) {
    this.file = new JsonFile<MailData>(
      path.join(dataDir, 'mail.json'),
      () => ({ version: 1, messages: [] }),
      (raw) => {
        const data = raw as Partial<MailData> | null;
        if (!data || !Array.isArray(data.messages)) return null;
        return {
          version: 1,
          messages: data.messages.filter(
            (entry): entry is MailMessage => !!entry && typeof entry.id === 'string',
          ),
        };
      },
    );
  }

  private get messages(): MailMessage[] {
    return this.file.value.messages;
  }

  list(filter: { folder?: MailFolder; unreadOnly?: boolean } = {}): MailMessage[] {
    return this.messages
      .filter(
        (entry) =>
          (!filter.folder || entry.folder === filter.folder) &&
          (!filter.unreadOnly || entry.unread),
      )
      .sort((a, b) => b.date - a.date)
      .map((entry) => ({ ...entry }));
  }

  get(id: string): MailMessage | null {
    const found = this.messages.find((entry) => entry.id === id);
    return found ? { ...found } : null;
  }

  unreadCount(): number {
    return this.messages.filter((entry) => entry.folder === 'inbox' && entry.unread).length;
  }

  private add(message: Omit<MailMessage, 'id'>): MailMessage {
    if (this.messages.length >= MAX_MESSAGES)
      throw new Error(`The mailbox is limited to ${MAX_MESSAGES} messages.`);
    const record: MailMessage = { id: randomUUID(), ...message };
    this.messages.push(record);
    this.file.touch();
    return { ...record };
  }

  /** "Send" stays inside AI OS: the message is filed in Sent. Nothing leaves the computer. */
  compose(input: MailInput, now = Date.now()): MailMessage {
    const subject = clean(input.subject, 200);
    const body = clean(input.body, MAX_BODY);
    if (!subject && !body) throw new Error('Write a subject or a message first.');
    return this.add({
      folder: 'sent',
      from: 'Me',
      to: clean(input.to, 300) || 'Myself',
      subject: subject || '(no subject)',
      body,
      date: now,
      unread: false,
      source: 'local',
    });
  }

  /** Put a message in the inbox (used by import and by AI OS's own notices). */
  deliver(
    message: { from: string; subject: string; body: string; date?: number },
    source: MailMessage['source'] = 'local',
  ): MailMessage {
    return this.add({
      folder: 'inbox',
      from: clean(message.from, 200) || 'Unknown sender',
      to: 'Me',
      subject: clean(message.subject, 200) || '(no subject)',
      body: clean(message.body, MAX_BODY),
      date: message.date ?? Date.now(),
      unread: true,
      source,
    });
  }

  setUnread(id: string, unread: boolean): MailMessage {
    const found = this.messages.find((entry) => entry.id === id);
    if (!found) throw new Error('That message no longer exists.');
    found.unread = unread;
    this.file.touch();
    return { ...found };
  }

  remove(id: string): boolean {
    const index = this.messages.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    this.messages.splice(index, 1);
    this.file.touch();
    return true;
  }

  importFile(text: string): ImportResult {
    if (!text.trim())
      return { ok: false, imported: 0, skipped: 0, notes: [], error: 'The file is empty.' };
    const parsed = parseMessageFile(text);
    const duplicate = this.messages.some(
      (entry) =>
        entry.subject === parsed.subject &&
        entry.date === parsed.date &&
        entry.from === parsed.from,
    );
    if (duplicate)
      return {
        ok: true,
        imported: 0,
        skipped: 1,
        notes: ['That message is already in the inbox.'],
      };
    this.deliver(parsed, 'imported');
    return { ok: true, imported: 1, skipped: 0, notes: [] };
  }

  flush(): void {
    this.file.flushSync();
  }
}
