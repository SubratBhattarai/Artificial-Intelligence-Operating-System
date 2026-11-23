import fs from 'node:fs';
import path from 'node:path';
import type { ApprovedApp } from '../../shared/platform';
import { JsonFile } from '../store/jsonFile';

export type { ApprovedApp };

interface Data {
  version: 1;
  custom: ApprovedApp[];
}

const BUILTIN: ApprovedApp[] = [
  { id: 'notepad', name: 'Notepad', exe: 'notepad.exe', builtin: true },
  {
    id: 'calculator',
    name: 'Calculator',
    exe: 'CalculatorApp.exe',
    path: 'calc.exe',
    builtin: true,
  },
  { id: 'paint', name: 'Paint', exe: 'mspaint.exe', builtin: true },
  { id: 'explorer', name: 'File Explorer', exe: 'explorer.exe', builtin: true },
  { id: 'snipping-tool', name: 'Snipping Tool', exe: 'SnippingTool.exe', builtin: true },
  { id: 'task-manager', name: 'Task Manager', exe: 'Taskmgr.exe', builtin: true },
  { id: 'control-panel', name: 'Control Panel', exe: 'control.exe', builtin: true },
  {
    id: 'settings',
    name: 'Settings',
    exe: 'SystemSettings.exe',
    path: 'ms-settings:',
    builtin: true,
  },
  { id: 'photos', name: 'Photos', exe: 'Photos.exe', path: 'ms-photos:', builtin: true },
  { id: 'clock', name: 'Clock', exe: 'Time.exe', path: 'ms-clock:', builtin: true },
];

/** Where common web browsers install themselves. Only browsers that really exist are offered. */
function browserCandidates(): ApprovedApp[] {
  const programFiles = process.env.ProgramFiles ?? 'C:\\Program Files';
  const programFilesX86 = process.env['ProgramFiles(x86)'] ?? 'C:\\Program Files (x86)';
  const localAppData = process.env.LOCALAPPDATA ?? '';
  const spec: Array<{ id: string; name: string; exe: string; dirs: string[] }> = [
    {
      id: 'brave',
      name: 'Brave',
      exe: 'brave.exe',
      dirs: [
        path.join(programFiles, 'BraveSoftware', 'Brave-Browser', 'Application'),
        path.join(programFilesX86, 'BraveSoftware', 'Brave-Browser', 'Application'),
        path.join(localAppData, 'BraveSoftware', 'Brave-Browser', 'Application'),
      ],
    },
    {
      id: 'chrome',
      name: 'Google Chrome',
      exe: 'chrome.exe',
      dirs: [
        path.join(programFiles, 'Google', 'Chrome', 'Application'),
        path.join(programFilesX86, 'Google', 'Chrome', 'Application'),
        path.join(localAppData, 'Google', 'Chrome', 'Application'),
      ],
    },
    {
      id: 'edge',
      name: 'Microsoft Edge',
      exe: 'msedge.exe',
      dirs: [path.join(programFilesX86, 'Microsoft', 'Edge', 'Application')],
    },
    {
      id: 'firefox',
      name: 'Firefox',
      exe: 'firefox.exe',
      dirs: [path.join(programFiles, 'Mozilla Firefox')],
    },
  ];
  const found: ApprovedApp[] = [];
  for (const browser of spec) {
    const dir = browser.dirs.find((candidate) => fs.existsSync(path.join(candidate, browser.exe)));
    if (dir)
      found.push({
        id: browser.id,
        name: browser.name,
        exe: browser.exe,
        path: path.join(dir, browser.exe),
        builtin: true,
      });
  }
  return found;
}

/** Closing these would take down the desktop or Windows itself. */
const NEVER_CLOSE = new Set([
  'explorer.exe',
  'winlogon.exe',
  'csrss.exe',
  'lsass.exe',
  'services.exe',
  'svchost.exe',
  'system',
  'dwm.exe',
]);

export function isCloseable(app: ApprovedApp): boolean {
  return !NEVER_CLOSE.has(app.exe.toLowerCase());
}

export function slugify(name: string): string {
  return name
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-|-$/g, '')
    .slice(0, 40);
}

/** The apps JARVIS may open or close. Built-ins plus programs the user adds with the file picker. */
export class AppsAllowlist {
  private readonly file: JsonFile<Data>;

  constructor(dataDir: string) {
    this.file = new JsonFile<Data>(
      path.join(dataDir, 'approved-apps.json'),
      () => ({ version: 1, custom: [] }),
      (raw) => {
        const data = raw as Partial<Data> | null;
        if (!data || !Array.isArray(data.custom)) return null;
        const custom = data.custom
          .filter(
            (entry): entry is ApprovedApp =>
              !!entry &&
              typeof entry.id === 'string' &&
              typeof entry.name === 'string' &&
              typeof entry.exe === 'string' &&
              typeof entry.path === 'string' &&
              /\.exe$/i.test(entry.path),
          )
          .map((entry) => ({ ...entry, builtin: false }));
        return { version: 1, custom };
      },
    );
  }

  list(): ApprovedApp[] {
    const taken = new Set([...BUILTIN, ...this.file.value.custom].map((app) => app.id));
    const browsers = browserCandidates().filter((app) => !taken.has(app.id));
    return [...BUILTIN, ...browsers, ...this.file.value.custom];
  }

  find(query: string): ApprovedApp | undefined {
    const wanted = query.trim().toLowerCase();
    if (!wanted) return undefined;
    return (
      this.list().find(
        (app) =>
          app.id === wanted ||
          app.name.toLowerCase() === wanted ||
          app.exe.toLowerCase() === wanted,
      ) ?? this.list().find((app) => app.name.toLowerCase().includes(wanted))
    );
  }

  /** Only called with a path the user chose in the native file picker. */
  add(exePath: string): ApprovedApp {
    const resolved = path.resolve(exePath);
    if (!/\.exe$/i.test(resolved)) throw new Error('Choose a program (.exe) file.');
    if (!fs.existsSync(resolved)) throw new Error('That file does not exist.');
    const base = path.basename(resolved, path.extname(resolved));
    const entry: ApprovedApp = {
      id: slugify(base) || 'app',
      name: base,
      exe: path.basename(resolved),
      path: resolved,
      builtin: false,
    };
    const others = this.file.value.custom.filter((app) => app.id !== entry.id);
    this.file.set({ version: 1, custom: [...others, entry] });
    return entry;
  }

  remove(id: string): boolean {
    const before = this.file.value.custom.length;
    const custom = this.file.value.custom.filter((app) => app.id !== id);
    if (custom.length === before) return false;
    this.file.set({ version: 1, custom });
    return true;
  }

  flush(): void {
    this.file.flushSync();
  }
}
