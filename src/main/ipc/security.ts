import type { IpcMain } from 'electron';
import type { SecurityReport } from '../../shared/security';
import { buildReport, parseJsonList, parseNetstat } from '../security/scan';
import type { AgentsRuntime } from './agents';
import type { Services } from '../services';
import { runPowerShell, runProcess } from '../system/runProcess';

const PROCESS_SCRIPT =
  "Get-CimInstance Win32_Process | Select-Object @{n='name';e={$_.Name}},@{n='pid';e={[int]$_.ProcessId}},@{n='path';e={[string]$_.ExecutablePath}} | ConvertTo-Json -Compress";
const DEFENDER_SCRIPT =
  'Get-MpComputerStatus | Select-Object RealTimeProtectionEnabled | ConvertTo-Json -Compress';
const FIREWALL_SCRIPT =
  'Get-NetFirewallProfile | Select-Object Name,Enabled | ConvertTo-Json -Compress';

export function registerSecurityIpc(
  ipcMain: IpcMain,
  services: Services,
  getNotify: () => AgentsRuntime['notify'] | null,
): { stop: () => void } {
  let last: SecurityReport | null = null;
  let running = false;

  async function scan(): Promise<SecurityReport> {
    if (process.platform !== 'win32') {
      return {
        ...buildReport({
          processes: [],
          connections: [],
          defender: 'unknown',
          firewall: 'unknown',
        }),
        note: 'The Security Center reads Windows only.',
      };
    }
    const [procs, net, defender, firewall] = await Promise.all([
      runPowerShell(PROCESS_SCRIPT, runProcess, { timeoutMs: 25_000 }),
      runProcess('netstat', ['-ano'], { timeoutMs: 15_000 }),
      runPowerShell(DEFENDER_SCRIPT, runProcess, { timeoutMs: 15_000 }),
      runPowerShell(FIREWALL_SCRIPT, runProcess, { timeoutMs: 15_000 }),
    ]);
    const defenderRows = parseJsonList<{ RealTimeProtectionEnabled?: boolean }>(defender.stdout);
    const firewallRows = parseJsonList<{ Enabled?: boolean | number }>(firewall.stdout);
    const report = buildReport({
      processes: parseJsonList<{ name?: string; pid?: number; path?: string }>(procs.stdout)
        .filter((p) => typeof p.name === 'string' && typeof p.pid === 'number')
        .map((p) => ({ name: p.name as string, pid: p.pid as number, path: p.path ?? '' })),
      connections: parseNetstat(net.stdout),
      defender:
        defenderRows.length === 0
          ? 'unknown'
          : defenderRows[0].RealTimeProtectionEnabled === false
            ? 'off'
            : 'on',
      firewall:
        firewallRows.length === 0
          ? 'unknown'
          : firewallRows.some((r) => r.Enabled === false || r.Enabled === 0)
            ? 'off'
            : 'on',
    });
    if (procs.exitCode !== 0 && procs.stdout.trim() === '')
      report.note = 'Could not read the process list.';
    last = report;
    const notify = getNotify();
    if (notify) {
      for (const finding of report.findings.filter((f) => f.level !== 'info')) {
        notify({
          source: 'security',
          title: finding.title,
          body: finding.why,
          key: `sec:${finding.key}`,
          securityLevel: finding.level === 'high' ? 'high' : 'medium',
        });
      }
    }
    return report;
  }

  const guarded = async (): Promise<SecurityReport> => {
    if (!services.permissions.allows('system', 'read')) {
      throw new Error('Allow "System info" in Settings › Permissions to use the Security Center.');
    }
    if (running) return last ?? scan();
    running = true;
    try {
      return await scan();
    } finally {
      running = false;
    }
  };

  ipcMain.handle('security:scan', () => guarded());
  ipcMain.handle('security:last', () => last);

  // Quiet background check every 30 minutes while the app is open and the user has allowed it.
  const timer = setInterval(() => {
    if (services.permissions.allows('system', 'read')) void guarded().catch(() => undefined);
  }, 30 * 60_000);
  return { stop: () => clearInterval(timer) };
}
