import { getContextGrant } from '../context/grants';
import { getShellSnapshot } from '../state/shellState';
import type { Tool } from './types';

/**
 * Read-only tool: report which shell apps/windows are open and what has focus.
 * Data comes from a snapshot the renderer pushes over IPC — the tool never mutates anything.
 */
export const appStatusTool: Tool<Record<string, never>, unknown> = {
  name: 'app_status',
  permissions: ['status:read'],
  description:
    'Get the current desktop shell status: open windows, which app is focused, window states, ' +
    "and how many windows are minimized. Needs the user's opt-in for the session. Read-only.",
  parameters: {
    type: 'object',
    properties: {},
    required: [],
    additionalProperties: false,
  },
  async execute() {
    if (!getContextGrant().windows) {
      return {
        available: false,
        reason:
          'The user has not allowed window context in this session. Ask them to turn on "Context" in the JARVIS panel.',
      };
    }
    const snapshot = getShellSnapshot();
    if (!snapshot) {
      return { available: false, reason: 'shell has not reported state yet' };
    }
    return {
      available: true,
      activeAppId: snapshot.activeAppId,
      windowCount: snapshot.windows.length,
      minimizedCount: snapshot.windows.filter((win) => win.state === 'minimized').length,
      windows: snapshot.windows.map((win) => ({
        appId: win.appId,
        title: win.title,
        state: win.state,
        focused: win.focused,
      })),
      updatedAt: snapshot.updatedAt,
    };
  },
};
