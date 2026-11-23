/** Minimal iCalendar (.ics) reader/writer for local calendar import and export. */

export interface IcsEvent {
  title: string;
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  notes: string;
}

export interface IcsParseResult {
  events: IcsEvent[];
  skipped: number;
  notes: string[];
}

function unfold(text: string): string[] {
  return text
    .replace(/\r\n[ \t]/g, '')
    .replace(/\n[ \t]/g, '')
    .split(/\r?\n/);
}

function unescapeText(value: string): string {
  return value.replace(/\\n/gi, '\n').replace(/\\([,;\\])/g, '$1');
}

function escapeText(value: string): string {
  return value
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

function parseIcsDate(value: string): { time: number; allDay: boolean } | null {
  const date = /^(\d{4})(\d{2})(\d{2})$/.exec(value);
  if (date) {
    return {
      time: new Date(Number(date[1]), Number(date[2]) - 1, Number(date[3])).getTime(),
      allDay: true,
    };
  }
  const stamp = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/.exec(value);
  if (!stamp) return null;
  const parts = stamp.slice(1, 7).map(Number);
  const time =
    stamp[7] === 'Z'
      ? Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5])
      : new Date(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]).getTime();
  return Number.isFinite(time) ? { time, allDay: false } : null;
}

export function parseIcs(text: string): IcsParseResult {
  const result: IcsParseResult = { events: [], skipped: 0, notes: [] };
  let current: Record<string, { value: string; params: string }> | null = null;
  let recurring = 0;
  for (const line of unfold(text)) {
    if (line === 'BEGIN:VEVENT') {
      current = {};
      continue;
    }
    if (line === 'END:VEVENT') {
      if (current) {
        const start = current.DTSTART ? parseIcsDate(current.DTSTART.value) : null;
        if (!start || !current.SUMMARY) {
          result.skipped += 1;
        } else {
          const end = current.DTEND ? parseIcsDate(current.DTEND.value) : null;
          const fallbackEnd = start.allDay ? start.time + 86_400_000 : start.time + 3_600_000;
          result.events.push({
            title: unescapeText(current.SUMMARY.value).slice(0, 200),
            start: start.time,
            end: end && end.time > start.time ? end.time : fallbackEnd,
            allDay: start.allDay,
            location: unescapeText(current.LOCATION?.value ?? '').slice(0, 300),
            notes: unescapeText(current.DESCRIPTION?.value ?? '').slice(0, 5000),
          });
          if (current.RRULE) recurring += 1;
        }
      }
      current = null;
      continue;
    }
    if (!current) continue;
    const colon = line.indexOf(':');
    if (colon < 0) continue;
    const [name, ...params] = line.slice(0, colon).split(';');
    current[name.toUpperCase()] = { value: line.slice(colon + 1), params: params.join(';') };
  }
  if (recurring > 0) {
    result.notes.push(
      `${recurring} repeating event(s) were imported once; repeats are not expanded.`,
    );
  }
  return result;
}

function formatIcsDate(time: number, allDay: boolean): string {
  const date = new Date(time);
  if (allDay) {
    return `${date.getFullYear()}${String(date.getMonth() + 1).padStart(2, '0')}${String(date.getDate()).padStart(2, '0')}`;
  }
  return date
    .toISOString()
    .replace(/[-:]/g, '')
    .replace(/\.\d{3}Z$/, 'Z');
}

export function buildIcs(events: Array<IcsEvent & { id: string }>, now = Date.now()): string {
  const lines = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//AI OS//Calendar//EN',
    'CALSCALE:GREGORIAN',
  ];
  for (const event of events) {
    lines.push(
      'BEGIN:VEVENT',
      `UID:${event.id}@ai-os.local`,
      `DTSTAMP:${formatIcsDate(now, false)}`,
    );
    if (event.allDay) {
      lines.push(`DTSTART;VALUE=DATE:${formatIcsDate(event.start, true)}`);
      lines.push(`DTEND;VALUE=DATE:${formatIcsDate(event.end, true)}`);
    } else {
      lines.push(
        `DTSTART:${formatIcsDate(event.start, false)}`,
        `DTEND:${formatIcsDate(event.end, false)}`,
      );
    }
    lines.push(`SUMMARY:${escapeText(event.title)}`);
    if (event.location) lines.push(`LOCATION:${escapeText(event.location)}`);
    if (event.notes) lines.push(`DESCRIPTION:${escapeText(event.notes)}`);
    lines.push('END:VEVENT');
  }
  lines.push('END:VCALENDAR');
  return `${lines.join('\r\n')}\r\n`;
}
