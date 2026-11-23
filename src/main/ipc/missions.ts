import type { IpcMain } from 'electron';
import type { MissionEvent } from '../../shared/missions';
import type { ModelAdapter } from '../llm/adapter';
import { MissionManager, MissionStore } from '../agents/missionManager';
import type { AgentManager } from '../agents/agentManager';
import type { Services } from '../services';
import { asId, asString } from './validate';

export function registerMissionsIpc(
  ipcMain: IpcMain,
  deps: {
    services: Services;
    adapter: ModelAdapter;
    agents: AgentManager;
    send: (channel: string, payload: unknown) => void;
  },
): { manager: MissionManager } {
  const store = new MissionStore(deps.services.dataDir);
  const manager = new MissionManager({
    adapter: deps.adapter,
    agents: deps.agents,
    store,
    reports: deps.services.reports,
    emit: (event: MissionEvent) => deps.send('missions:event', event),
  });
  ipcMain.handle('missions:list', () => manager.list());
  ipcMain.handle('missions:create', (_e, objective: unknown) =>
    manager.create(asString(objective, 'objective', 500)),
  );
  ipcMain.handle('missions:approve', (_e, id: unknown) => manager.approve(asId(id, 'mission id')));
  ipcMain.handle('missions:pause', (_e, id: unknown) => manager.pause(asId(id, 'mission id')));
  ipcMain.handle('missions:resume', (_e, id: unknown) => manager.resume(asId(id, 'mission id')));
  ipcMain.handle('missions:cancel', (_e, id: unknown) => manager.cancel(asId(id, 'mission id')));
  ipcMain.handle('missions:remove', (_e, id: unknown) => {
    manager.remove(asId(id, 'mission id'));
    return manager.list();
  });
  return { manager };
}
