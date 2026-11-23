/**
 * What the user lets AI OS (and JARVIS) touch. Enforced in ordinary code — the language model
 * can neither grant nor widen a permission.
 */

export type PermissionId =
  | 'microphone'
  | 'camera'
  | 'calendar'
  | 'tasks'
  | 'notes'
  | 'mail'
  | 'files'
  | 'memory'
  | 'calculator'
  | 'internet'
  | 'web'
  | 'screen'
  | 'apps'
  | 'terminal'
  | 'devices'
  | 'agents'
  | 'system'
  | 'activity'
  | 'clipboard';

/** off = denied; read = JARVIS may look; write = JARVIS may also propose changes (still approved one by one). */
export type PermissionLevel = 'off' | 'read' | 'write';

export interface PermissionDefinition {
  id: PermissionId;
  label: string;
  description: string;
  /** Levels the user can pick. Hardware is simply on or off. */
  levels: PermissionLevel[];
  kind: 'hardware' | 'data';
}

export const PERMISSIONS: PermissionDefinition[] = [
  {
    id: 'microphone',
    label: 'Microphone',
    description:
      'Listen for "Jarvis" and take voice commands. A MIC indicator shows whenever it is on.',
    levels: ['off', 'write'],
    kind: 'hardware',
  },
  {
    id: 'camera',
    label: 'Camera',
    description: 'Lets the Camera app use your webcam. A CAMERA indicator shows whenever it is on.',
    levels: ['off', 'write'],
    kind: 'hardware',
  },
  {
    id: 'calendar',
    label: 'Calendar',
    description: 'JARVIS can read events and propose new ones you approve.',
    levels: ['off', 'read', 'write'],
    kind: 'data',
  },
  {
    id: 'tasks',
    label: 'Tasks',
    description: 'JARVIS can read tasks and propose creating or completing them.',
    levels: ['off', 'read', 'write'],
    kind: 'data',
  },
  {
    id: 'notes',
    label: 'Notes',
    description: 'JARVIS can propose saving a note for you.',
    levels: ['off', 'write'],
    kind: 'data',
  },
  {
    id: 'mail',
    label: 'Mail',
    description: 'JARVIS can read your local AI OS inbox. It can never send mail.',
    levels: ['off', 'read'],
    kind: 'data',
  },
  {
    id: 'files',
    label: 'Files',
    description:
      'Read: JARVIS can search and read documents in folders you chose. Read & propose: it can also propose creating, moving or editing files inside those folders (you approve each one).',
    levels: ['off', 'read', 'write'],
    kind: 'data',
  },
  {
    id: 'memory',
    label: 'Memory',
    description:
      'JARVIS can search what you saved and suggest facts to remember (you approve them).',
    levels: ['off', 'read', 'write'],
    kind: 'data',
  },
  {
    id: 'calculator',
    label: 'Calculator',
    description: 'JARVIS can use the calculator for exact arithmetic.',
    levels: ['off', 'read'],
    kind: 'data',
  },
  {
    id: 'internet',
    label: 'Open in browser',
    description:
      'Lets JARVIS open a web search or page in your Windows browser, only when you ask and only after you approve the exact address. AI OS never reads the page.',
    levels: ['off', 'write'],
    kind: 'data',
  },
  {
    id: 'web',
    label: 'Web access',
    description:
      'Lets AI OS itself fetch weather, news headlines and public web pages for the briefing, research and monitors. https only, never private addresses, text only; page text is treated as untrusted.',
    levels: ['off', 'read'],
    kind: 'data',
  },
  {
    id: 'screen',
    label: 'Screen reading',
    description:
      'Lets JARVIS take a screenshot when you ask and read the text on it. Nothing is saved, and a SCREEN indicator shows while it happens.',
    levels: ['off', 'write'],
    kind: 'hardware',
  },
  {
    id: 'apps',
    label: 'Open & close apps',
    description:
      'JARVIS can propose opening or closing applications from your approved apps list. You approve each one.',
    levels: ['off', 'write'],
    kind: 'data',
  },
  {
    id: 'terminal',
    label: 'Terminal commands',
    description:
      'JARVIS can propose a command. You see the exact text and approve every run; dangerous commands are blocked outright.',
    levels: ['off', 'write'],
    kind: 'data',
  },
  {
    id: 'devices',
    label: 'Volume & brightness',
    description: 'JARVIS can propose changing system volume, mute and screen brightness.',
    levels: ['off', 'write'],
    kind: 'data',
  },
  {
    id: 'agents',
    label: 'Background agents',
    description:
      'JARVIS can start agents that research and work on multi-step tasks while AI OS is open. Anything consequential still asks you first.',
    levels: ['off', 'write'],
    kind: 'data',
  },
  {
    id: 'system',
    label: 'System info',
    description: 'JARVIS can read CPU, memory and disk usage.',
    levels: ['off', 'read'],
    kind: 'data',
  },
  {
    id: 'activity',
    label: 'Active app & window',
    description:
      'JARVIS can see the name and title of the app you are using when you ask, so it understands what you are working on. Nothing is recorded.',
    levels: ['off', 'read'],
    kind: 'data',
  },
  {
    id: 'clipboard',
    label: 'Clipboard',
    description:
      'JARVIS can read what you copied, only when you ask, and only after you approve each read. It never watches the clipboard in the background.',
    levels: ['off', 'read'],
    kind: 'data',
  },
];

export type PermissionMap = Record<PermissionId, PermissionLevel>;

export const PERMISSION_IDS: PermissionId[] = PERMISSIONS.map((entry) => entry.id);

export function emptyPermissions(): PermissionMap {
  return Object.fromEntries(PERMISSION_IDS.map((id) => [id, 'off'])) as PermissionMap;
}

export function isPermissionId(value: unknown): value is PermissionId {
  return typeof value === 'string' && (PERMISSION_IDS as string[]).includes(value);
}

export function isPermissionLevel(value: unknown): value is PermissionLevel {
  return value === 'off' || value === 'read' || value === 'write';
}

const RANK: Record<PermissionLevel, number> = { off: 0, read: 1, write: 2 };

export function levelAllows(granted: PermissionLevel, needed: PermissionLevel): boolean {
  return RANK[granted] >= RANK[needed] && needed !== 'off';
}

/** Which permission, at which level, a tool permission string needs. `null` = always allowed. */
export function requirementFor(
  toolPermission: string,
): { id: PermissionId; level: PermissionLevel } | null {
  switch (toolPermission) {
    case 'status:read':
      return null;
    case 'files:read':
      return { id: 'files', level: 'read' };
    case 'memory:read':
      return { id: 'memory', level: 'read' };
    case 'memory:suggest':
      return { id: 'memory', level: 'write' };
    case 'tasks:read':
      return { id: 'tasks', level: 'read' };
    case 'tasks:write':
      return { id: 'tasks', level: 'write' };
    case 'calendar:read':
      return { id: 'calendar', level: 'read' };
    case 'calendar:write':
      return { id: 'calendar', level: 'write' };
    case 'notes:write':
      return { id: 'notes', level: 'write' };
    case 'mail:read':
      return { id: 'mail', level: 'read' };
    case 'calculator:use':
      return { id: 'calculator', level: 'read' };
    case 'web:open':
      return { id: 'internet', level: 'write' };
    case 'web:read':
      return { id: 'web', level: 'read' };
    case 'files:write':
      return { id: 'files', level: 'write' };
    case 'screen:capture':
      return { id: 'screen', level: 'write' };
    case 'apps:control':
      return { id: 'apps', level: 'write' };
    case 'terminal:run':
      return { id: 'terminal', level: 'write' };
    case 'devices:control':
      return { id: 'devices', level: 'write' };
    case 'agents:run':
      return { id: 'agents', level: 'write' };
    case 'system:read':
      return { id: 'system', level: 'read' };
    case 'activity:read':
      return { id: 'activity', level: 'read' };
    case 'clipboard:read':
      return { id: 'clipboard', level: 'read' };
    case 'camera:capture':
      return { id: 'camera', level: 'write' };
    default:
      // Unknown permission strings fail closed.
      return { id: 'system', level: 'write' };
  }
}

export function labelOf(id: PermissionId): string {
  return PERMISSIONS.find((entry) => entry.id === id)?.label ?? id;
}
