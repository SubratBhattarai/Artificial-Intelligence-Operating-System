import type { IpcMain } from 'electron';
import path from 'node:path';
import {
  DEFAULT_BRIEFING_SETTINGS,
  type Briefing,
  type BriefingSettings,
} from '../../shared/briefing';
import { buildBriefing, createWeatherLookup, dayKey } from '../briefing/briefing';
import type { Services } from '../services';
import { JsonFile } from '../store/jsonFile';
import { checkPublicHttpsUrl } from '../tools/webTarget';
import { fetchPage } from '../web/fetcher';
import { parseFeed } from '../web/text';
import { asObject } from './validate';

function sanitize(raw: unknown, current: BriefingSettings): BriefingSettings {
  const input = asObject(raw, 'settings');
  const feeds = Array.isArray(input.feeds)
    ? input.feeds
        .filter((f): f is string => typeof f === 'string')
        .map((f) => f.trim())
        .filter((f) => f && checkPublicHttpsUrl(f).ok)
        .slice(0, 3)
    : current.feeds;
  return {
    city: typeof input.city === 'string' ? input.city.trim().slice(0, 80) : current.city,
    units: input.units === 'metric' ? 'metric' : 'imperial',
    feeds,
    atLaunch: typeof input.atLaunch === 'boolean' ? input.atLaunch : current.atLaunch,
    lastLaunchDay: current.lastLaunchDay,
  };
}

export function registerBriefingIpc(ipcMain: IpcMain, services: Services): void {
  const file = new JsonFile<BriefingSettings>(
    path.join(services.dataDir, 'briefing.json'),
    () => ({ ...DEFAULT_BRIEFING_SETTINGS }),
    (raw) => ({ ...DEFAULT_BRIEFING_SETTINGS, ...(raw as Partial<BriefingSettings>) }),
  );

  const fetchJson = async (url: string): Promise<unknown> =>
    JSON.parse((await fetchPage(url, { accept: 'application/json' })).body);

  const build = (): Promise<Briefing> =>
    buildBriefing(
      {
        now: () => new Date(),
        can: (id, level) => services.permissions.allows(id, level),
        events: (range) => services.events.list(range),
        tasks: () => services.tasks.list(),
        unreadMail: () => services.mail.list({ folder: 'inbox', unreadOnly: true }),
        weather: createWeatherLookup(fetchJson),
        headlines: async (url) =>
          parseFeed(
            (await fetchPage(url, { accept: 'application/rss+xml,application/xml,text/xml' })).body,
          ),
      },
      file.value,
    );

  ipcMain.handle('briefing:get', () => build());
  ipcMain.handle('briefing:settings', () => file.value);
  ipcMain.handle('briefing:save-settings', (_e, raw: unknown) => {
    file.set(sanitize(raw, file.value));
    return file.value;
  });
  /** Returns true once per local day, when the launch briefing is due. */
  ipcMain.handle('briefing:launch-due', () => {
    const today = dayKey(new Date());
    if (!file.value.atLaunch || file.value.lastLaunchDay === today) return false;
    file.set({ ...file.value, lastLaunchDay: today });
    return true;
  });
}
