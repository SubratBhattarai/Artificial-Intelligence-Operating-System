import type { IpcMain } from 'electron';
import {
  LAB_COMMAND_IDS,
  LAB_TEMPLATES,
  type LabCommandId,
  type LabTemplate,
} from '../../shared/lab';
import type { LabManager } from '../lab/lab';
import { asString } from './validate';

/**
 * Buttons in the Lab app are the user's own clicks, so they run directly. Fixed commands only.
 * Opening the preview is restricted to the loopback URL the Lab itself started.
 */
export function registerLabIpc(
  ipcMain: IpcMain,
  lab: LabManager,
  openExternal: (url: string) => Promise<void>,
): void {
  ipcMain.handle('lab:list', () => lab.list());
  ipcMain.handle('lab:create', async (_e, name: unknown, template: unknown) => {
    const kind = asString(template, 'template', 30);
    if (!LAB_TEMPLATES.includes(kind as LabTemplate)) throw new Error('Unknown template.');
    await lab.create(asString(name, 'name', 40), kind as LabTemplate);
    return lab.list();
  });
  ipcMain.handle('lab:run', (_e, project: unknown, command: unknown) => {
    const id = asString(command, 'command', 30);
    if (!LAB_COMMAND_IDS.includes(id as LabCommandId)) throw new Error('Unknown command.');
    return lab.run(asString(project, 'project', 40), id as LabCommandId);
  });
  ipcMain.handle('lab:preview', async (_e, project: unknown, start: unknown) => {
    const name = asString(project, 'project', 40);
    if (start === true) await lab.startPreview(name);
    else lab.stopPreview(name);
    return lab.list();
  });
  ipcMain.handle('lab:openPreview', async (_e, project: unknown) => {
    const url = lab.previewUrl(asString(project, 'project', 40));
    if (!url || !url.startsWith('http://127.0.0.1:')) throw new Error('Start the preview first.');
    await openExternal(url);
  });
}
