import type { IpcMain } from 'electron';
import type { Services } from '../services';
import type { ToolRegistry } from '../tools';
import { asId } from './validate';

/** Approval decisions, the audit log and per-tool switches. Only the renderer's own clicks reach these. */
export function registerToolsIpc(
  ipcMain: IpcMain,
  services: Services,
  registry: ToolRegistry,
): void {
  ipcMain.handle('tools:decide', (_event, approvalId: unknown, approve: unknown) =>
    services.approvals.decide(asId(approvalId, 'approval id'), approve === true),
  );
  ipcMain.handle('tools:pending', () => services.approvals.listPending());
  ipcMain.handle('tools:set-enabled', (_event, name: unknown, enabled: unknown) => {
    const toolName = asId(name, 'tool name');
    if (!registry.names().includes(toolName)) throw new Error('Unknown tool.');
    services.toolSettings.setEnabled(toolName, enabled === true);
    return registry.descriptors();
  });
  ipcMain.handle('audit:list', () => services.audit.list(300));
  ipcMain.handle('audit:clear', () => services.audit.clear());
}
