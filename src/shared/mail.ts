/** The local AI OS mailbox. Everything lives inside the app; nothing is sent anywhere. */

export type MailFolder = 'inbox' | 'sent';

export interface MailMessage {
  id: string;
  folder: MailFolder;
  from: string;
  to: string;
  subject: string;
  body: string;
  /** Epoch milliseconds. */
  date: number;
  unread: boolean;
  source: 'local' | 'imported';
}

export interface MailInput {
  to: string;
  subject: string;
  body: string;
}

/** Words that suggest a message is about something due. Used by the briefing, never for decisions. */
export const DEADLINE_PATTERN =
  /\b(deadline|due|submit|submission|exam|quiz|assignment|midterm|final|by (?:mon|tue|wed|thu|fri|sat|sun)[a-z]*|tomorrow|tonight|today|asap)\b/i;
