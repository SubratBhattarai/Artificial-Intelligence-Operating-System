/**
 * Hard limits on terminal commands JARVIS may propose. This is a floor, not a replacement for the
 * approval click: the user still sees and approves the exact text of every command.
 */

const MAX_COMMAND_LENGTH = 600;

interface Rule {
  pattern: RegExp;
  reason: string;
}

const BLOCKED: Rule[] = [
  { pattern: /\bformat(\.com)?\s+[a-z]:/i, reason: 'formats a drive' },
  {
    pattern: /\b(diskpart|bcdedit|cipher\s+\/w|vssadmin|wbadmin|bootrec|sfc\s+\/scannow\s*&)/i,
    reason: 'changes disks or boot data',
  },
  {
    pattern: /\b(shutdown|logoff|restart-computer|stop-computer)\b/i,
    reason: 'turns off or restarts the computer',
  },
  { pattern: /\breg(\.exe)?\s+(add|delete|import|load|restore)\b/i, reason: 'edits the registry' },
  { pattern: /\b(set|new|remove)-itemproperty\b.*\bhk(lm|cu|cr)\b/i, reason: 'edits the registry' },
  {
    pattern: /\bnet\s+(user|localgroup)\b|\bnetsh\s+(advfirewall|firewall)\b/i,
    reason: 'changes accounts or the firewall',
  },
  { pattern: /\b(takeown|icacls|cacls)\b/i, reason: 'changes file ownership or permissions' },
  {
    pattern: /\bschtasks\s+\/(create|change|delete)\b|\bsc(\.exe)?\s+(create|delete|config)\b/i,
    reason: 'creates or changes services or scheduled tasks',
  },
  {
    pattern: /\b(del|erase|rd|rmdir|remove-item|rm)\b[^|&;]*\s(\/s|-recurse|-r\b|-rf\b)/i,
    reason: 'recursively deletes files',
  },
  {
    pattern: /\b(del|erase)\b[^|&;]*\s[a-z]:\\(\*|windows|users)?\s*$/i,
    reason: 'deletes system or user folders',
  },
  { pattern: /-enc(odedcommand)?\b/i, reason: 'hides what a PowerShell command does' },
  { pattern: /\b(iex|invoke-expression)\b/i, reason: 'runs downloaded text as code' },
  {
    pattern: /\b(curl|wget|iwr|invoke-webrequest|invoke-restmethod|bitsadmin|certutil)\b/i,
    reason: 'downloads from the internet (use the browser or Web access instead)',
  },
  {
    pattern: /\b(start-process|invoke-item)\b.*-verb\s+runas/i,
    reason: 'asks for administrator rights',
  },
  {
    pattern: /\bdefender\b.*\b(disable|exclusion|set-mppreference)\b|\bset-mppreference\b/i,
    reason: 'weakens security protection',
  },
  {
    pattern: /[<>]\s*[a-z]:\\windows\\|\\system32\\.*\s*(>|>>)/i,
    reason: 'writes into system folders',
  },
];

export interface CommandAssessment {
  ok: boolean;
  reason?: string;
}

export function assessCommand(command: string): CommandAssessment {
  const text = command.trim();
  if (text.length === 0) return { ok: false, reason: 'The command is empty.' };
  if (text.length > MAX_COMMAND_LENGTH) return { ok: false, reason: 'The command is too long.' };
  if (/[\r\n\0]/.test(text)) return { ok: false, reason: 'Commands must be a single line.' };
  for (const rule of BLOCKED) {
    if (rule.pattern.test(text)) {
      return { ok: false, reason: `Blocked: this command ${rule.reason}.` };
    }
  }
  return { ok: true };
}
