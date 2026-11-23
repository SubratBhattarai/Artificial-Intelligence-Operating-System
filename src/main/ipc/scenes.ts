import type { IpcMain } from 'electron';
import type { Services } from '../services';
import { asId, asObject, asString } from './validate';

export function registerScenesIpc(ipcMain: IpcMain, services: Services): void {
  ipcMain.handle('scenes:list', () => services.scenes.list());
  ipcMain.handle('scenes:save', (_e, raw: unknown) => {
    const input = asObject(raw, 'scene');
    services.scenes.save({
      id: typeof input.id === 'string' ? input.id : undefined,
      name: asString(input.name, 'name', 40),
      steps: input.steps,
    });
    return services.scenes.list();
  });
  ipcMain.handle('scenes:remove', (_e, id: unknown) => {
    services.scenes.remove(asId(id, 'scene id'));
    return services.scenes.list();
  });
}
