import { dialog, shell, type BrowserWindow, type IpcMain, type WebContents } from 'electron';
import type {
  AskDocsRequest,
  DocsEvent,
  FileIndexOverview,
  IndexProgress,
} from '../../shared/protocol';
import { resolveAllowedReal, allowDroppedFiles } from '../fs/allowed';
import { askDocuments } from '../files/docQa';
import { isOpenable, previewFile } from '../files/preview';
import type { ModelAdapter } from '../llm/adapter';
import type { Services } from '../services';
import { asObject, asString } from './validate';

const activeQuestions = new Map<string, AbortController>();
let indexAbort: AbortController | null = null;

export function registerFilesIpc(
  ipcMain: IpcMain,
  services: Services,
  adapter: ModelAdapter,
  getWindow: () => BrowserWindow | null,
  getContents: () => WebContents | null,
): void {
  const { fileIndex } = services;

  const send = (channel: string, payload: unknown) => {
    const contents = getContents();
    if (contents && !contents.isDestroyed()) contents.send(channel, payload);
  };

  const startIndexing = (folder?: string): boolean => {
    if (fileIndex.isRunning) return false;
    indexAbort = new AbortController();
    void fileIndex
      .reindex({
        folder,
        signal: indexAbort.signal,
        onProgress: (progress: IndexProgress) => send('files:progress', progress),
      })
      .catch((error: unknown) => {
        send('files:progress', {
          phase: 'error',
          folder: folder ?? null,
          scanned: 0,
          indexed: 0,
          unchanged: 0,
          unreadable: 0,
          removed: 0,
          message: error instanceof Error ? error.message : String(error),
        } satisfies IndexProgress);
      });
    return true;
  };

  /** Files dragged in by the user: readable one by one, this session only. */
  ipcMain.handle('files:allow-dropped', async (_event, paths: unknown) =>
    allowDroppedFiles(
      Array.isArray(paths) ? paths.filter((p): p is string => typeof p === 'string') : [],
    ),
  );
  ipcMain.handle('files:overview', (): FileIndexOverview => fileIndex.overview());

  /** Explicit folder selection: only a native folder picker can add a folder to the index. */
  ipcMain.handle('files:pickFolder', async () => {
    const window = getWindow();
    const options = {
      title: 'Choose a folder for AI OS to browse and index',
      properties: ['openDirectory' as const],
    };
    const result = window
      ? await dialog.showOpenDialog(window, options)
      : await dialog.showOpenDialog(options);
    if (result.canceled || result.filePaths.length === 0) return { added: null };
    const folder = await fileIndex.addFolder(result.filePaths[0]);
    startIndexing(folder.path);
    return { added: folder.path };
  });

  ipcMain.handle('files:removeFolder', (_event, target: unknown) => ({
    removedFiles: fileIndex.removeFolder(asString(target, 'folder', 2000)),
  }));

  ipcMain.handle('files:reindex', (_event, folder?: unknown) => ({
    started: startIndexing(typeof folder === 'string' ? folder : undefined),
  }));

  ipcMain.handle('files:cancelIndex', () => {
    indexAbort?.abort();
    return true;
  });

  ipcMain.handle('files:search', (_event, query: unknown, limit?: unknown) => {
    const text = asString(query, 'query', 500).trim();
    if (!text) return [];
    const max = typeof limit === 'number' ? Math.min(50, Math.max(1, Math.floor(limit))) : 25;
    return fileIndex.search(text, max);
  });

  ipcMain.handle('files:preview', async (_event, target: unknown) => {
    const real = await resolveAllowedReal(asString(target, 'path', 2000));
    return previewFile(real, fileIndex);
  });

  /** Opens in the default app. Executables and scripts are refused; the source is never modified. */
  ipcMain.handle('files:open', async (_event, target: unknown) => {
    const real = await resolveAllowedReal(asString(target, 'path', 2000));
    if (!isOpenable(real)) {
      throw new Error(
        'For safety, programs and scripts are not opened from here. Use "Show in folder".',
      );
    }
    const error = await shell.openPath(real);
    if (error) throw new Error(error);
    return true;
  });

  ipcMain.handle('files:reveal', async (_event, target: unknown) => {
    shell.showItemInFolder(await resolveAllowedReal(asString(target, 'path', 2000)));
    return true;
  });

  /* ---- document Q&A with citations ---- */
  const emitDocs = (event: DocsEvent) => send('docs:event', event);

  ipcMain.handle('docs:ask', (_event, request: unknown) => {
    const data = asObject(request, 'request');
    const question = asString(data.question, 'question', 2000).trim();
    if (!question) throw new Error('Ask a question first.');
    const requestId =
      typeof data.requestId === 'string' && /^[\w-]{1,64}$/.test(data.requestId)
        ? data.requestId
        : `docs_${Date.now()}`;

    for (const [staleId, controller] of activeQuestions) {
      controller.abort();
      activeQuestions.delete(staleId);
    }
    const controller = new AbortController();
    activeQuestions.set(requestId, controller);
    void askDocuments({
      requestId,
      question,
      adapter,
      index: fileIndex,
      signal: controller.signal,
      emit: emitDocs,
    }).finally(() => activeQuestions.delete(requestId));
    return { requestId } satisfies Pick<AskDocsRequest, 'requestId'>;
  });

  ipcMain.handle('docs:cancel', (_event, requestId: unknown) => {
    const controller = typeof requestId === 'string' ? activeQuestions.get(requestId) : undefined;
    controller?.abort();
    return Boolean(controller);
  });
}
