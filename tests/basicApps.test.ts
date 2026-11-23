import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { AppsAllowlist } from '../src/main/apps/appsAllowlist';
import { resolveLaunch } from '../src/main/tools/computerTools';

describe('basic Windows apps', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'apps-'));
  const apps = new AppsAllowlist(dir);
  it('offers the common utilities by name', () => {
    for (const name of ['settings', 'snipping tool', 'task manager', 'notepad', 'calculator']) {
      expect(apps.find(name) !== undefined).toBe(true);
    }
  });
  it('launches link-style apps through Explorer, only for fixed schemes', () => {
    expect(resolveLaunch('ms-settings:')).toEqual({
      file: 'explorer.exe',
      args: ['ms-settings:'],
    });
    expect(resolveLaunch('calc.exe')).toEqual({ file: 'calc.exe', args: [] });
    expect(resolveLaunch('http://evil.example/')).toEqual({
      file: 'http://evil.example/',
      args: [],
    });
  });
  it('lists no browser that is not installed', () => {
    for (const app of apps
      .list()
      .filter((entry) => ['brave', 'chrome', 'edge', 'firefox'].includes(entry.id))) {
      expect(fs.existsSync(app.path ?? '')).toBe(true);
    }
  });
});
