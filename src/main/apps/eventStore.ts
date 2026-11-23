import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  EventInput,
  EventPatch,
  EventRecord,
  RecordSource,
  ImportResult,
} from '../../shared/apps';
import { buildIcs, parseIcs } from '../../shared/ics';
import { JsonFile } from '../store/jsonFile';

const MAX_EVENTS = 5000;
const DAY_MS = 86_400_000;
const HOUR_MS = 3_600_000;

interface EventData {
  version: 1;
  events: EventRecord[];
}

function cleanTitle(value: unknown): string {
  if (typeof value !== 'string') throw new Error('An event needs a title.');
  const title = value.replace(/\s+/g, ' ').trim();
  if (!title) throw new Error('An event needs a title.');
  return title.slice(0, 200);
}

function cleanTime(value: unknown, label: string): number {
  if (
    typeof value !== 'number' ||
    !Number.isFinite(value) ||
    value < 0 ||
    value > 4_102_444_800_000
  ) {
    throw new Error(`The ${label} time is not valid.`);
  }
  return Math.round(value);
}

/** Local calendar. Events live on this machine; .ics import/export is the way in and out. */
export class EventStore {
  private readonly file: JsonFile<EventData>;

  constructor(dataDir: string) {
    this.file = new JsonFile<EventData>(
      path.join(dataDir, 'events.json'),
      () => ({ version: 1, events: [] }),
      (raw) => {
        const data = raw as Partial<EventData> | null;
        if (!data || !Array.isArray(data.events)) return null;
        return {
          version: 1,
          events: data.events.filter(
            (event): event is EventRecord =>
              !!event && typeof event.id === 'string' && typeof event.start === 'number',
          ),
        };
      },
    );
  }

  private get events(): EventRecord[] {
    return this.file.value.events;
  }

  /** Events overlapping [from, to) (all events when no range is given), earliest first. */
  list(range: { from?: number; to?: number } = {}): EventRecord[] {
    const from = range.from ?? -Infinity;
    const to = range.to ?? Infinity;
    return this.events
      .filter((event) => event.end > from && event.start < to)
      .sort((a, b) => a.start - b.start)
      .map((event) => ({ ...event }));
  }

  get(id: string): EventRecord | null {
    const event = this.events.find((entry) => entry.id === id);
    return event ? { ...event } : null;
  }

  create(input: EventInput, source: RecordSource = 'user', now = Date.now()): EventRecord {
    if (this.events.length >= MAX_EVENTS) throw new Error(`Events are limited to ${MAX_EVENTS}.`);
    const allDay = input.allDay === true;
    const start = cleanTime(input.start, 'start');
    const end = cleanTime(input.end ?? start + (allDay ? DAY_MS : HOUR_MS), 'end');
    if (end <= start) throw new Error('An event must end after it starts.');
    const event: EventRecord = {
      id: randomUUID(),
      title: cleanTitle(input.title),
      start,
      end,
      allDay,
      location: String(input.location ?? '').slice(0, 300),
      notes: String(input.notes ?? '').slice(0, 5000),
      createdAt: now,
      updatedAt: now,
      source,
    };
    this.events.push(event);
    this.file.touch();
    return { ...event };
  }

  update(id: string, patch: EventPatch, now = Date.now()): EventRecord {
    const event = this.events.find((entry) => entry.id === id);
    if (!event) throw new Error('That event no longer exists.');
    const start = patch.start !== undefined ? cleanTime(patch.start, 'start') : event.start;
    const end = patch.end !== undefined ? cleanTime(patch.end, 'end') : event.end;
    if (end <= start) throw new Error('An event must end after it starts.');
    if (patch.title !== undefined) event.title = cleanTitle(patch.title);
    if (patch.allDay !== undefined) event.allDay = patch.allDay === true;
    if (patch.location !== undefined) event.location = String(patch.location).slice(0, 300);
    if (patch.notes !== undefined) event.notes = String(patch.notes).slice(0, 5000);
    event.start = start;
    event.end = end;
    event.updatedAt = now;
    this.file.touch();
    return { ...event };
  }

  remove(id: string): boolean {
    const index = this.events.findIndex((entry) => entry.id === id);
    if (index < 0) return false;
    this.events.splice(index, 1);
    this.file.touch();
    return true;
  }

  /** Add events from .ics text, skipping ones already present (same title and start). */
  importIcs(text: string): ImportResult {
    const parsed = parseIcs(text);
    let imported = 0;
    let skipped = parsed.skipped;
    for (const item of parsed.events) {
      const duplicate = this.events.some(
        (event) => event.title === item.title && event.start === item.start,
      );
      if (duplicate || this.events.length >= MAX_EVENTS) {
        skipped += 1;
        continue;
      }
      this.create(item, 'user');
      imported += 1;
    }
    return { ok: true, imported, skipped, notes: parsed.notes };
  }

  exportIcs(): string {
    return buildIcs(
      this.list().map((event) => ({
        id: event.id,
        title: event.title,
        start: event.start,
        end: event.end,
        allDay: event.allDay,
        location: event.location,
        notes: event.notes,
      })),
    );
  }

  flush(): void {
    this.file.flushSync();
  }
}
