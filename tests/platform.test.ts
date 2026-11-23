import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { evaluateExpression, formatResult } from '../src/shared/calc';
import {
  createBackup,
  inspectBackup,
  isBackupFileName,
  restoreBackup,
} from '../src/main/storage/backup';
import { PermissionStore } from '../src/main/permissions/permissionStore';
import { redactSecrets } from '../src/main/tools/audit';

const dirs: string[] = [];
function tmp(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-'));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length) fs.rmSync(dirs.pop() as string, { recursive: true, force: true });
});

describe('permissions', () => {
  it('start off and deny tools until granted', () => {
    const store = new PermissionStore(tmp());
    expect(store.level('camera')).toBe('off');
    expect(store.checkTool(['calendar:read'])).toContain('permission_denied');
    store.set('calendar', 'read');
    expect(store.checkTool(['calendar:read'])).toBeNull();
    expect(store.checkTool(['calendar:write'])).toContain('permission_denied');
  });
  it('revokeAll switches everything off again', () => {
    const store = new PermissionStore(tmp());
    store.set('calendar', 'write');
    store.revokeAll();
    expect(store.checkTool(['calendar:read'])).toContain('permission_denied');
  });
  it('rejects unknown permission strings (fails closed)', () => {
    const store = new PermissionStore(tmp());
    expect(store.checkTool(['made_up:thing'])).not.toBeNull();
  });
});

describe('calculator', () => {
  it('evaluates with precedence and parentheses', () => {
    expect(evaluateExpression('2+3*4')).toBe(14);
    expect(evaluateExpression('(2+3)*4')).toBe(20);
    expect(formatResult(evaluateExpression('1/4'))).toBe('0.25');
  });
  it('refuses code and division by zero', () => {
    expect(() => evaluateExpression('process.exit()')).toThrow();
    expect(() => evaluateExpression('1/0')).toThrow();
  });
});

describe('backup', () => {
  it('excludes permissions and validates names', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'tasks.json'), '{"a":1}');
    fs.writeFileSync(path.join(dir, 'permissions.json'), '{"levels":{"microphone":"write"}}');
    const backup = createBackup(dir, '1.0.0');
    expect(Object.keys(backup.files)).toEqual(['tasks.json']);
    expect(isBackupFileName('../evil.json')).toBe(false);
    expect(isBackupFileName('permissions.json')).toBe(false);
  });
  it('ignores hostile names and rejects damaged files', () => {
    const hostile = JSON.stringify({
      format: 'ai-os-backup',
      version: 1,
      files: { '../x.json': '{}', 'permissions.json': '{}', 'tasks.json': '{}' },
    });
    expect(inspectBackup(hostile).check.files).toEqual(['tasks.json']);
    const damaged = JSON.stringify({
      format: 'ai-os-backup',
      version: 1,
      files: { 'tasks.json': '{oops' },
    });
    expect(inspectBackup(damaged).check.ok).toBe(false);
    expect(inspectBackup('not json').check.ok).toBe(false);
  });
  it('restores and keeps a safety copy', () => {
    const dir = tmp();
    fs.writeFileSync(path.join(dir, 'tasks.json'), '{"old":true}');
    const parsed = inspectBackup(
      JSON.stringify({
        format: 'ai-os-backup',
        version: 1,
        files: { 'tasks.json': '{"new":true}' },
      }),
    );
    const result = restoreBackup(dir, parsed.backup as NonNullable<typeof parsed.backup>);
    expect(fs.readFileSync(path.join(dir, 'tasks.json'), 'utf8')).toBe('{"new":true}');
    expect(fs.readFileSync(path.join(result.safetyCopy, 'tasks.json'), 'utf8')).toBe(
      '{"old":true}',
    );
  });
});

describe('audit redaction', () => {
  it('hides secrets', () => {
    expect(redactSecrets('key sk-abcdefghijklmnop1234 end')).not.toContain('abcdefghijklmnop1234');
  });
});
