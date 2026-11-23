import type {
  Connection,
  ProcessInfo,
  SecurityFinding,
  SecurityReport,
} from '../../shared/security';

/** Programs whose real copy lives in the Windows folder. The same name elsewhere is a classic disguise. */
const SYSTEM_NAMES = new Set([
  'svchost.exe',
  'lsass.exe',
  'csrss.exe',
  'winlogon.exe',
  'services.exe',
  'smss.exe',
  'explorer.exe',
  'taskhostw.exe',
  'dwm.exe',
]);
const LOOKALIKES: Record<string, string> = {
  'svch0st.exe': 'svchost.exe',
  'scvhost.exe': 'svchost.exe',
  'lsasss.exe': 'lsass.exe',
  'iexplorer.exe': 'explorer.exe',
  'expl0rer.exe': 'explorer.exe',
  'csrs.exe': 'csrss.exe',
};
const RISKY_FOLDER = /\\(appdata\\local\\temp|temp|downloads|\$recycle\.bin)\\/i;
const WINDOWS_FOLDER = /^[a-z]:\\windows\\(system32|syswow64|explorer\.exe)/i;

export function classifyProcess(process: ProcessInfo): SecurityFinding | null {
  const name = process.name.toLowerCase();
  const path = process.path;
  if (LOOKALIKES[name]) {
    return {
      key: `proc:${name}:${path}`,
      level: 'high',
      title: `${process.name} looks like a disguised ${LOOKALIKES[name]}`,
      why: `The name is one character away from a real Windows program (${LOOKALIKES[name]}). Malware often does this.`,
    };
  }
  if (
    path &&
    SYSTEM_NAMES.has(name) &&
    !WINDOWS_FOLDER.test(path) &&
    !/^[a-z]:\\windows\\explorer\.exe$/i.test(path)
  ) {
    return {
      key: `proc:${name}:${path}`,
      level: 'high',
      title: `${process.name} is running from an unusual place`,
      why: `The real ${process.name} runs from the Windows folder, but this one runs from ${path}.`,
    };
  }
  if (path && RISKY_FOLDER.test(path)) {
    return {
      key: `proc:${name}:${path}`,
      level: 'medium',
      title: `${process.name} runs from a temporary or downloads folder`,
      why: `Installed programs rarely run from ${path}. It may be an installer you just opened, or something that should not be there.`,
    };
  }
  return null;
}

/** Parse `netstat -ano` output (TCP and UDP rows). */
export function parseNetstat(text: string): Connection[] {
  const rows: Connection[] = [];
  for (const raw of text.split(/\r?\n/)) {
    const parts = raw.trim().split(/\s+/);
    if (parts[0] === 'TCP' && parts.length >= 5) {
      rows.push({
        proto: 'TCP',
        local: parts[1],
        remote: parts[2],
        state: parts[3],
        pid: Number(parts[4]),
      });
    } else if (parts[0] === 'UDP' && parts.length >= 4) {
      rows.push({
        proto: 'UDP',
        local: parts[1],
        remote: parts[2],
        state: '',
        pid: Number(parts[3]),
      });
    }
  }
  return rows.filter((row) => Number.isInteger(row.pid));
}

function portOf(address: string): number {
  const port = Number(address.slice(address.lastIndexOf(':') + 1));
  return Number.isInteger(port) ? port : 0;
}

export function parseJsonList<T>(text: string): T[] {
  const trimmed = text.trim();
  if (!trimmed) return [];
  try {
    const parsed: unknown = JSON.parse(trimmed);
    return (Array.isArray(parsed) ? parsed : [parsed]) as T[];
  } catch {
    return [];
  }
}

export interface ScanInputs {
  processes: ProcessInfo[];
  connections: Connection[];
  defender: 'on' | 'off' | 'unknown';
  firewall: 'on' | 'off' | 'unknown';
  now?: number;
}

export function buildReport(input: ScanInputs): SecurityReport {
  const names = new Map(input.processes.map((p) => [p.pid, p.name]));
  const nameOf = (pid: number): string => names.get(pid) ?? `pid ${pid}`;
  const findings: SecurityFinding[] = [];
  const seen = new Set<string>();
  for (const process of input.processes) {
    const finding = classifyProcess(process);
    if (finding && !seen.has(finding.key)) {
      seen.add(finding.key);
      findings.push(finding);
    }
  }
  if (input.defender === 'off') {
    findings.push({
      key: 'defender-off',
      level: 'high',
      title: 'Windows virus protection is off',
      why: 'Real-time protection is turned off, so malware would not be stopped automatically.',
    });
  }
  if (input.firewall === 'off') {
    findings.push({
      key: 'firewall-off',
      level: 'high',
      title: 'Windows Firewall is off for a network profile',
      why: 'With the firewall off, other devices on the network can reach your computer more easily.',
    });
  }

  const listenMap = new Map<number, string>();
  for (const row of input.connections) {
    if (
      row.proto === 'TCP' &&
      row.state === 'LISTENING' &&
      /^(0\.0\.0\.0|\[::\]):/.test(row.local)
    ) {
      listenMap.set(portOf(row.local), nameOf(row.pid));
    }
  }
  const established = new Map<string, number>();
  for (const row of input.connections) {
    if (row.state === 'ESTABLISHED' && !/^(127\.|\[::1\])/.test(row.remote)) {
      const name = nameOf(row.pid);
      established.set(name, (established.get(name) ?? 0) + 1);
    }
  }
  for (const [name, count] of established) {
    if (count >= 40) {
      findings.push({
        key: `conns:${name}`,
        level: 'medium',
        title: `${name} has ${count} open connections`,
        why: 'Browsers and sync tools do this normally; an unfamiliar program with many connections deserves a look.',
      });
    }
  }
  const order = { high: 0, medium: 1, info: 2 } as const;
  findings.sort((a, b) => order[a.level] - order[b.level]);

  return {
    scannedAt: input.now ?? Date.now(),
    processCount: input.processes.length,
    listening: [...listenMap]
      .map(([port, process]) => ({ port, process }))
      .sort((a, b) => a.port - b.port)
      .slice(0, 30),
    established: [...established]
      .map(([process, count]) => ({ process, count }))
      .sort((a, b) => b.count - a.count)
      .slice(0, 12),
    defender: input.defender,
    firewall: input.firewall,
    findings,
  };
}
