import { DEADLINE_PATTERN, type MailMessage } from '../../shared/mail';
import type { EventRecord, TaskRecord } from '../../shared/apps';
import type { Briefing, BriefingSection, BriefingSettings } from '../../shared/briefing';
import type { PermissionId, PermissionLevel } from '../../shared/permissions';
import type { FeedItem } from '../web/text';

export interface BriefingDeps {
  now: () => Date;
  can: (id: PermissionId, level: PermissionLevel) => boolean;
  events: (range: { from: number; to: number }) => EventRecord[];
  tasks: () => TaskRecord[];
  unreadMail: () => MailMessage[];
  /** Resolves to short text lines, or throws. Only called when Web access is allowed. */
  weather: (city: string, units: 'imperial' | 'metric') => Promise<string[]>;
  headlines: (feedUrl: string) => Promise<FeedItem[]>;
}

const WEATHER_WORDS: Record<number, string> = {
  0: 'clear',
  1: 'mostly clear',
  2: 'partly cloudy',
  3: 'overcast',
  45: 'foggy',
  48: 'foggy',
  51: 'light drizzle',
  53: 'drizzle',
  55: 'heavy drizzle',
  61: 'light rain',
  63: 'rain',
  65: 'heavy rain',
  71: 'light snow',
  73: 'snow',
  75: 'heavy snow',
  80: 'rain showers',
  81: 'rain showers',
  82: 'heavy showers',
  95: 'thunderstorms',
  96: 'thunderstorms with hail',
  99: 'thunderstorms with hail',
};

export function describeWeatherCode(code: number): string {
  return WEATHER_WORDS[code] ?? 'mixed conditions';
}

export function dayKey(date: Date): string {
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}-${String(date.getDate()).padStart(2, '0')}`;
}

function timeLabel(ms: number): string {
  return new Date(ms).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
}

export function greetingFor(date: Date): string {
  const hour = date.getHours();
  if (hour < 5) return 'Good evening';
  if (hour < 12) return 'Good morning';
  if (hour < 18) return 'Good afternoon';
  return 'Good evening';
}

function off(id: BriefingSection['id'], title: string, permission: string): BriefingSection {
  return {
    id,
    title,
    lines: [],
    unavailable: `${permission} is off. You can allow it in Settings › Permissions.`,
  };
}

function plural(count: number, one: string, many = `${one}s`): string {
  return `${count} ${count === 1 ? one : many}`;
}

/** Build the briefing from local data plus (only when allowed) two public lookups. */
export async function buildBriefing(
  deps: BriefingDeps,
  settings: BriefingSettings,
): Promise<Briefing> {
  const now = deps.now();
  const today = dayKey(now);
  const start = new Date(now);
  start.setHours(0, 0, 0, 0);
  const range = { from: start.getTime(), to: start.getTime() + 24 * 60 * 60 * 1000 };
  const sections: BriefingSection[] = [];

  // Schedule
  if (deps.can('calendar', 'read')) {
    const events = deps.events(range).sort((a, b) => a.start - b.start);
    sections.push({
      id: 'schedule',
      title: "Today's schedule",
      lines:
        events.length === 0
          ? ['Nothing on your calendar today.']
          : events.map((e) => (e.allDay ? e.title : `${timeLabel(e.start)} — ${e.title}`)),
    });
  } else sections.push(off('schedule', "Today's schedule", 'Calendar access'));

  // Mail
  const deadlineMail: MailMessage[] = [];
  if (deps.can('mail', 'read')) {
    const unread = deps.unreadMail();
    deadlineMail.push(...unread.filter((m) => DEADLINE_PATTERN.test(`${m.subject} ${m.body}`)));
    sections.push({
      id: 'mail',
      title: 'Important email',
      lines:
        unread.length === 0
          ? ['No unread mail.']
          : [
              `${plural(unread.length, 'unread message')}.`,
              ...deadlineMail
                .slice(0, 4)
                .map((m) => `${m.from}: ${m.subject} (mentions a deadline)`),
            ],
    });
  } else sections.push(off('mail', 'Important email', 'Mail access'));

  // Weather and news need Web access, which is a separate permission.
  if (!deps.can('web', 'read')) {
    sections.push(off('weather', 'Weather', 'Web access'));
    sections.push(off('news', 'News', 'Web access'));
  } else {
    if (!settings.city.trim()) {
      sections.push({
        id: 'weather',
        title: 'Weather',
        lines: [],
        unavailable: 'Add your city in the Briefing settings to get a forecast.',
      });
    } else {
      try {
        sections.push({
          id: 'weather',
          title: 'Weather',
          lines: await deps.weather(settings.city.trim(), settings.units),
        });
      } catch (error) {
        sections.push({
          id: 'weather',
          title: 'Weather',
          lines: [],
          unavailable: `Could not get the forecast (${error instanceof Error ? error.message : 'lookup failed'}).`,
        });
      }
    }
    if (settings.feeds.length === 0) {
      sections.push({
        id: 'news',
        title: 'News',
        lines: [],
        unavailable: 'No news feeds are set.',
      });
    } else {
      const lines: string[] = [];
      let failures = 0;
      for (const feed of settings.feeds.slice(0, 3)) {
        try {
          lines.push(...(await deps.headlines(feed)).slice(0, 4).map((item) => item.title));
        } catch {
          failures += 1;
        }
      }
      sections.push({
        id: 'news',
        title: 'News',
        lines: lines.slice(0, 6),
        unavailable:
          lines.length === 0 && failures > 0 ? 'Could not reach the news feeds.' : undefined,
      });
    }
  }

  // Tasks
  if (deps.can('tasks', 'read')) {
    const open = deps.tasks().filter((t) => t.status !== 'done');
    const dueSoon = open
      .filter((t) => t.due !== null && t.due <= addDays(today, 3))
      .sort((a, b) => (a.due as string).localeCompare(b.due as string));
    const overdue = open.filter((t) => t.due !== null && t.due < today);
    const dueToday = open.filter((t) => t.due === today);
    sections.push({
      id: 'deadlines',
      title: 'Upcoming deadlines',
      lines:
        dueSoon.length === 0 && deadlineMail.length === 0
          ? ['No deadlines in the next three days.']
          : [
              ...dueSoon.map(
                (t) =>
                  `${t.title} — ${t.due === today ? 'today' : t.due! < today ? `overdue (${t.due})` : `due ${t.due}`}`,
              ),
              ...deadlineMail.slice(0, 3).map((m) => `Email: ${m.subject}`),
            ],
    });
    sections.push({
      id: 'reminders',
      title: 'Important reminders',
      lines:
        overdue.length + dueToday.length === 0
          ? ['Nothing overdue or due today.']
          : [
              ...(overdue.length
                ? [`${plural(overdue.length, 'task is', 'tasks are')} overdue.`]
                : []),
              ...(dueToday.length
                ? [`${plural(dueToday.length, 'task is', 'tasks are')} due today.`]
                : []),
            ],
    });
    const undated = open.filter((t) => t.due === null || t.due > addDays(today, 3));
    sections.push({
      id: 'tasks',
      title: "Tasks you haven't completed",
      lines:
        open.length === 0
          ? ['All caught up.']
          : [`${plural(open.length, 'open task')}.`, ...undated.slice(0, 4).map((t) => t.title)],
    });
  } else {
    sections.push(off('deadlines', 'Upcoming deadlines', 'Task access'));
    sections.push(off('reminders', 'Important reminders', 'Task access'));
    sections.push(off('tasks', "Tasks you haven't completed", 'Task access'));
  }

  const greeting = `${greetingFor(now)}.`;
  return {
    generatedAt: now.getTime(),
    day: today,
    greeting,
    sections,
    spoken: [greeting, ...sections.map(speakSection)],
  };
}

export function addDays(key: string, days: number): string {
  const [y, m, d] = key.split('-').map(Number);
  return dayKey(new Date(y, m - 1, d + days));
}

function speakSection(section: BriefingSection): string {
  if (section.unavailable) return `${section.title}: ${section.unavailable}`;
  return `${section.title}. ${section.lines.join('. ').replace(/\.\./g, '.')}`;
}

/* ---------- public lookups (injected into BriefingDeps by the IPC layer) ---------- */

interface GeoResponse {
  results?: { latitude: number; longitude: number; name: string; admin1?: string }[];
}
interface ForecastResponse {
  current?: { temperature_2m: number; weather_code: number };
  daily?: {
    temperature_2m_max: number[];
    temperature_2m_min: number[];
    precipitation_probability_max: number[];
  };
}

export function formatForecast(
  place: string,
  data: ForecastResponse,
  units: 'imperial' | 'metric',
): string[] {
  const unit = units === 'imperial' ? '°F' : '°C';
  if (!data.current || !data.daily) throw new Error('unexpected forecast format');
  const high = Math.round(data.daily.temperature_2m_max[0]);
  const low = Math.round(data.daily.temperature_2m_min[0]);
  const rain = data.daily.precipitation_probability_max?.[0];
  const lines = [
    `${place}: ${Math.round(data.current.temperature_2m)}${unit} and ${describeWeatherCode(data.current.weather_code)} now.`,
    `High ${high}${unit}, low ${low}${unit}.`,
  ];
  if (typeof rain === 'number') lines.push(`${Math.round(rain)} percent chance of precipitation.`);
  return lines;
}

export function createWeatherLookup(fetchJson: (url: string) => Promise<unknown>) {
  return async (city: string, units: 'imperial' | 'metric'): Promise<string[]> => {
    const geo = (await fetchJson(
      `https://geocoding-api.open-meteo.com/v1/search?name=${encodeURIComponent(city)}&count=1`,
    )) as GeoResponse;
    const hit = geo.results?.[0];
    if (!hit) throw new Error(`no place named "${city}"`);
    const forecast = (await fetchJson(
      `https://api.open-meteo.com/v1/forecast?latitude=${hit.latitude}&longitude=${hit.longitude}` +
        `&current=temperature_2m,weather_code&daily=temperature_2m_max,temperature_2m_min,precipitation_probability_max` +
        `&temperature_unit=${units === 'imperial' ? 'fahrenheit' : 'celsius'}&timezone=auto&forecast_days=1`,
    )) as ForecastResponse;
    return formatForecast(hit.name, forecast, units);
  };
}
