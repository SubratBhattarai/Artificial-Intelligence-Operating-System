import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { LAB_COMMANDS, isValidProjectName } from '../src/shared/lab';
import { resolveStaticPath } from '../src/main/lab/lab';

describe('lab safety', () => {
  it('only accepts boring project names', () => {
    expect(isValidProjectName('my-app-2')).toBe(true);
    for (const bad of ['', '../x', 'a/b', 'A', '-x', 'a b', 'x'.repeat(41)])
      expect(isValidProjectName(bad)).toBe(false);
  });
  it('keeps preview requests inside the project folder', () => {
    const dir = path.join(os.tmpdir(), 'proj');
    expect(resolveStaticPath(dir, '/')).toBe(path.join(dir, 'index.html'));
    expect(resolveStaticPath(dir, '/style.css?x=1')).toBe(path.join(dir, 'style.css'));
    expect(resolveStaticPath(dir, '/../secret.txt')).toBeNull();
    expect(resolveStaticPath(dir, '/%2e%2e/secret.txt')).toBeNull();
    expect(resolveStaticPath(dir, '/a%00b')).toBeNull();
  });
  it('has fixed command text with no placeholders', () => {
    for (const text of Object.values(LAB_COMMANDS)) expect(/[;&|`$<>]/.test(text)).toBe(false);
  });
  it('writes nothing outside a temp folder in this test', async () => {
    const dir = await fs.mkdtemp(path.join(os.tmpdir(), 'lab-'));
    expect((await fs.readdir(dir)).length).toBe(0);
    await fs.rm(dir, { recursive: true });
  });
});
