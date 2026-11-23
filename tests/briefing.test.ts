import { describe, expect, it } from 'vitest';
import { DEFAULT_BRIEFING_SETTINGS } from '../src/shared/briefing';
import { buildBriefing, formatForecast, type BriefingDeps } from '../src/main/briefing/briefing';
import { BRIEFING_COMMAND } from '../src/renderer/state/briefingCommand';

const NOW = new Date(2026, 10, 23, 8, 30);

function deps(overrides: Partial<BriefingDeps> = {}): BriefingDeps {
  return {
    now: () => NOW,
    can: () => true,
    events: () => [],
    tasks: () => [],
    unreadMail: () => [],
    weather: async () => ['Dubuque: 40°F and clear now.'],
    headlines: async () => [{ title: 'A headline', link: '', published: '' }],
    ...overrides,
  };
}

describe('daily briefing', () => {
  it('reports sections whose permission is off instead of skipping silently', async () => {
    const briefing = await buildBriefing(deps({ can: () => false }), DEFAULT_BRIEFING_SETTINGS);
    expect(briefing.sections.every((s) => s.unavailable !== undefined)).toBe(true);
  });

  it('flags overdue and due-today tasks', async () => {
    const task = (id: string, due: string) =>
      ({
        id,
        title: id,
        notes: '',
        status: 'todo',
        priority: 'normal',
        due,
        createdAt: 0,
        updatedAt: 0,
        completedAt: null,
        source: 'user',
      }) as never;
    const briefing = await buildBriefing(
      deps({ tasks: () => [task('late', '2026-11-20'), task('now', '2026-11-23')] }),
      DEFAULT_BRIEFING_SETTINGS,
    );
    const reminders = briefing.sections.find((s) => s.id === 'reminders');
    expect(reminders?.lines.join(' ')).toContain('overdue');
    expect(reminders?.lines.join(' ')).toContain('due today');
  });

  it('survives a failing weather lookup', async () => {
    const briefing = await buildBriefing(
      deps({
        weather: async () => {
          throw new Error('offline');
        },
      }),
      { ...DEFAULT_BRIEFING_SETTINGS, city: 'Dubuque' },
    );
    expect(briefing.sections.find((s) => s.id === 'weather')?.unavailable).toContain('offline');
    expect(briefing.sections.find((s) => s.id === 'news')?.lines).toEqual(['A headline']);
  });

  it('formats a forecast and matches the spoken command', () => {
    const lines = formatForecast(
      'Dubuque',
      {
        current: { temperature_2m: 40.4, weather_code: 0 },
        daily: {
          temperature_2m_max: [45],
          temperature_2m_min: [30],
          precipitation_probability_max: [10],
        },
      },
      'imperial',
    );
    expect(lines[0]).toContain('40°F');
    expect(BRIEFING_COMMAND.test('Jarvis, give me my daily briefing')).toBe(true);
    expect(BRIEFING_COMMAND.test('write a briefing about whales')).toBe(false);
  });
});
