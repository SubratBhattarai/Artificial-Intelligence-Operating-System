import { describe, expect, it } from 'vitest';
import { buildReport, classifyProcess, parseNetstat } from '../src/main/security/scan';

describe('security scan heuristics', () => {
  it('flags a system name running from outside the Windows folder', () => {
    const finding = classifyProcess({
      name: 'svchost.exe',
      pid: 1,
      path: 'C:\\Users\\a\\AppData\\Local\\Temp\\svchost.exe',
    });
    expect(finding?.level).toBe('high');
    expect(
      classifyProcess({ name: 'svchost.exe', pid: 2, path: 'C:\\Windows\\System32\\svchost.exe' }),
    ).toBeNull();
  });

  it('flags look-alike names and temp-folder programs', () => {
    expect(classifyProcess({ name: 'scvhost.exe', pid: 3, path: '' })?.level).toBe('high');
    expect(
      classifyProcess({ name: 'setup.exe', pid: 4, path: 'C:\\Users\\a\\Downloads\\setup.exe' })
        ?.level,
    ).toBe('medium');
    expect(
      classifyProcess({ name: 'code.exe', pid: 5, path: 'C:\\Program Files\\code.exe' }),
    ).toBeNull();
  });

  it('parses netstat and reports protection that is off', () => {
    const rows = parseNetstat(
      '  TCP    0.0.0.0:445    0.0.0.0:0    LISTENING    4\n  TCP    10.0.0.2:5000    1.2.3.4:443    ESTABLISHED    9\n',
    );
    expect(rows).toHaveLength(2);
    const report = buildReport({
      processes: [
        { name: 'System', pid: 4, path: '' },
        { name: 'chrome.exe', pid: 9, path: 'C:\\Program Files\\chrome.exe' },
      ],
      connections: rows,
      defender: 'off',
      firewall: 'on',
    });
    expect(report.listening[0]).toEqual({ port: 445, process: 'System' });
    expect(report.findings[0].key).toBe('defender-off');
  });
});
