import { shutdownSpeechEngine } from './voice/transcribe';
import path from 'node:path';
import { app, BrowserWindow, clipboard, globalShortcut, ipcMain, session, shell } from 'electron';
import { config } from './config';
import { registerChatIpc } from './ipc/chat';
import { registerFilesIpc } from './ipc/files';
import { registerMemoryIpc } from './ipc/memory';
import { getMetrics, registerSystemIpc, setSummonRegistered } from './ipc/system';
import { registerVoiceIpc } from './ipc/voice';
import { createAdapter } from './llm/adapter';
import { createServices, flushServices, type Services } from './services';
import { createRegistry } from './tools';
import { registerAppsIpc } from './ipc/apps';
import { registerPlatformIpc } from './ipc/platform';
import { isSpeechEngineLoaded } from './voice/transcribe';
import { CameraCapturer, isJpegDataUrl, scanFrame } from './awareness/awareness';
import { LabManager } from './lab/lab';
import { registerLabIpc } from './ipc/lab';
import { registerMissionsIpc } from './ipc/missions';
import { registerScenesIpc } from './ipc/scenes';
import { registerTtsIpc } from './ipc/tts';
import { registerSecurityIpc } from './ipc/security';
import { registerBriefingIpc } from './ipc/briefing';
import { registerAgentsIpc, type AgentsRuntime } from './ipc/agents';
import { setImageTextReader } from './files/extract';
import { createOcrEngine } from './system/ocr';
import { createScreenReader } from './system/screen';
import { registerToolsIpc } from './ipc/tools';

const DEV_SERVER_URL = process.env.VITE_DEV_SERVER_URL;

let mainWindow: BrowserWindow | null = null;

// Single instance: a desktop shell should never run twice (second launch focuses the first).
const hasSingleInstanceLock = app.requestSingleInstanceLock();
if (!hasSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', () => {
    if (mainWindow) {
      if (mainWindow.isMinimized()) mainWindow.restore();
      mainWindow.focus();
    }
  });
}

let windowsCreated = 0;
let services: Services | null = null;

function isAppOrigin(url: string): boolean {
  return DEV_SERVER_URL ? url.startsWith(DEV_SERVER_URL) : url.startsWith('file://');
}

/** Only this app's own pages may use the microphone, and only audio — never camera or anything else. */
/**
 * Hardware access follows the user's switches in Settings › Permissions, decided here in code:
 * the microphone only with the Microphone switch on, the camera only with the Camera switch on,
 * and only for AI OS's own pages. Everything else (screen capture, notifications, ...) is refused.
 */
function configurePermissions(permissions: Services['permissions']): void {
  const decide = (permission: string, mediaTypes: string[], url: string): boolean => {
    if (permission !== 'media' || !isAppOrigin(url) || mediaTypes.length === 0) return false;
    return mediaTypes.every((type) =>
      type === 'audio'
        ? permissions.allows('microphone', 'write')
        : type === 'video'
          ? permissions.allows('camera', 'write')
          : false,
    );
  };
  const defaultSession = session.defaultSession;
  defaultSession.setPermissionRequestHandler((contents, permission, callback, details) => {
    const mediaTypes = (details as { mediaTypes?: string[] }).mediaTypes ?? [];
    const url = (details as { requestingUrl?: string }).requestingUrl ?? contents.getURL();
    callback(decide(permission, mediaTypes, url));
  });
  defaultSession.setPermissionCheckHandler((_contents, permission, requestingOrigin, details) => {
    const mediaType = (details as { mediaType?: string }).mediaType;
    return decide(permission, mediaType ? [mediaType] : [], requestingOrigin);
  });
}

function createWindow(): void {
  windowsCreated += 1;
  console.log(`[ai-os] createWindow #${windowsCreated}`);
  mainWindow = new BrowserWindow({
    width: 1440,
    height: 900,
    minWidth: 960,
    minHeight: 600,
    show: false,
    backgroundColor: '#0b1020',
    autoHideMenuBar: true,
    title: 'AI OS',
    webPreferences: {
      preload: path.join(__dirname, '../preload/index.js'),
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      spellcheck: false,
    },
  });

  mainWindow.once('ready-to-show', () => mainWindow?.show());

  // Self-check mode: AIOS_SMOKE=1 boots the shell, verifies the DOM rendered, reports, quits.
  if (process.env.AIOS_SMOKE_FRESH) {
    // Start from a clean persisted layout so smoke runs are reproducible.
    void mainWindow.webContents.session.clearStorageData({ storages: ['localstorage'] });
  }
  if (process.env.AIOS_SMOKE) {
    const smokeChat = Boolean(process.env.AIOS_SMOKE_CHAT);
    setTimeout(() => {
      void mainWindow?.webContents
        .executeJavaScript(
          `(async () => {
            const dom = JSON.stringify({
              root: document.getElementById('root')?.childElementCount ?? 0,
              windows: document.querySelectorAll('.window').length,
              icons: document.querySelectorAll('.desktop-icon').length,
              dock: document.querySelectorAll('.dock-item').length,
              topBar: document.querySelectorAll('.top-bar').length,
              storage: localStorage.getItem('aios.layout.v1'),
              titles: [...document.querySelectorAll('.titlebar-title')].map((n) => n.textContent),
              openTrace: window.__openTrace,
              keys: window.__keyTrace ?? null,
              ptrs: window.__ptrTrace ?? null,
            });
            ${
              smokeChat
                ? `const events = [];
            const off = window.aios.chat.onEvent((e) => events.push(e));
            await window.aios.chat.start({
              requestId: 'smoke_chat_' + Date.now(),
              messages: [{ role: 'user', content: 'Which apps are open right now? One short sentence.' }],
            });
            const deadline = Date.now() + 60000;
            while (Date.now() < deadline && !events.some((e) => e.type === 'done' || e.type === 'error')) {
              await new Promise((r) => setTimeout(r, 500));
            }
            off();
            const chat = JSON.stringify({
              eventTypes: events.map((e) => e.type),
              toolCalls: events.filter((e) => e.type === 'tool_call').map((e) => e.call.name),
              final: events.filter((e) => e.type === 'text').map((e) => e.text).join('').slice(0, 200),
              cancelled: events.some((e) => e.type === 'cancelled'),
              error: events.find((e) => e.type === 'error')?.message ?? null,
            });
            const after = JSON.stringify({
              windows: document.querySelectorAll('.window').length,
              titles: [...document.querySelectorAll('.titlebar-title')].map((n) => n.textContent),
              storage: localStorage.getItem('aios.layout.v1'),
              openTrace: window.__openTrace,
            });
            return dom + '|||' + chat + '|||' + after;`
                : `return dom;`
            }
          })()`,
        )
        .then((result) => {
          console.log(
            `[smoke] ${result} |||win:${JSON.stringify({ created: windowsCreated, alive: BrowserWindow.getAllWindows().length })}`,
          );
          app.quit();
        })
        .catch((error) => {
          console.error(`[smoke] failed: ${error}`);
          app.exit(1);
        });
    }, 6000);
  }

  mainWindow.on('closed', () => {
    mainWindow = null;
  });

  if (DEV_SERVER_URL) {
    void mainWindow.loadURL(DEV_SERVER_URL);
    mainWindow.webContents.openDevTools({ mode: 'detach' });
    mainWindow.webContents.on('console-message', (_event, level, message) => {
      if (level >= 2) console.log(`[renderer] ${message}`);
    });
    mainWindow.webContents.on('did-fail-load', (_event, code, description, url) => {
      console.error(`[ai-os] failed to load ${url}: ${description} (${code})`);
    });
  } else {
    void mainWindow.loadFile(path.join(__dirname, '../renderer/index.html'));
  }
}

app.whenReady().then(() => {
  if (!hasSingleInstanceLock) return;

  const adapter = createAdapter();
  // Load the language model in the background so the first answer is fast.
  setTimeout(() => void adapter.warmUp?.(), 1500);

  // All user data lives in one local folder: <userData>/data (memory, notes, conversations, file index).
  services = createServices(path.join(app.getPath('userData'), 'data'));
  const getWindow = () => mainWindow;
  const getContents = () => mainWindow?.webContents ?? null;
  ocrEngine = createOcrEngine({
    appRoot: app.getAppPath(),
    cacheDir: path.join(app.getPath('userData'), 'ocr'),
  });
  // Pictures in the Files app are read on request with the same offline text recognition.
  setImageTextReader((image) => ocrEngine!.recognize(image));
  // eslint-disable-next-line prefer-const
  let agents: AgentsRuntime;

  const registry = createRegistry(services, {
    getMetrics,
    openExternal: (url) => shell.openExternal(url),
    lab: labManager,
    openShellApp: (appId) => getContents()?.send('shell:openApp', appId),
    awareness: {
      getMetrics,
      readClipboard: () => clipboard.readText(),
      camera: cameraCapturer,
      ollamaBaseUrl: config.ollama.baseUrl,
      visionModel: process.env.AIOS_VISION_MODEL,
      ocr: (image) => ocrEngine!.recognize(image),
    },
    getAgentManager: () => agents.manager,
    screen: createScreenReader({
      getWindow,
      ocr: ocrEngine,
      onActivity: (active) => getContents()?.send('screen:activity', active),
    }),
  });

  configurePermissions(services.permissions);
  registerSystemIpc(adapter, registry, services.fileIndex);
  registerChatIpc(ipcMain, getContents, adapter, registry, services);
  registerMemoryIpc(ipcMain, services, getWindow);
  registerFilesIpc(ipcMain, services, adapter, getWindow, getContents);
  const voice = registerVoiceIpc(ipcMain, () => mainWindow?.webContents ?? null);
  // Load the stored speech model in the background so the first "Jarvis" answers at once.
  setTimeout(() => void voice.warmUp(), 2500);
  registerPlatformIpc(ipcMain, {
    services,
    getWindow,
    currentSpeechModel: voice.currentModel,
    isSpeechModelLoaded: isSpeechEngineLoaded,
  });
  registerToolsIpc(ipcMain, services, registry);
  registerAppsIpc(ipcMain, services, getWindow);
  agents = registerAgentsIpc(ipcMain, { services, adapter, registry, getWindow, getContents });
  agentsRuntime = agents;
  registerBriefingIpc(ipcMain, services);
  registerScenesIpc(ipcMain, services);
  ipcMain.handle('awareness:scan', async (_e, dataUrl: unknown, question: unknown) => {
    if (!services?.permissions.allows('camera', 'write')) throw new Error('Camera access is off.');
    if (!isJpegDataUrl(dataUrl)) throw new Error('That is not a camera picture.');
    const asked = typeof question === 'string' ? question.trim().slice(0, 200) : '';
    return scanFrame(dataUrl, asked || undefined, {
      baseUrl: config.ollama.baseUrl,
      visionModel: process.env.AIOS_VISION_MODEL,
      ocr: (image) => ocrEngine!.recognize(image),
    });
  });
  ipcMain.handle('awareness:captureResult', (_e, id: unknown, dataUrl: unknown, error: unknown) =>
    cameraCapturer.complete(typeof id === 'string' ? id : '', dataUrl, error),
  );
  registerLabIpc(ipcMain, labManager, (url) => shell.openExternal(url));
  registerMissionsIpc(ipcMain, {
    services,
    adapter,
    agents: agents.manager,
    send: (channel, payload) => getContents()?.send(channel, payload),
  });
  ttsRuntime = registerTtsIpc(ipcMain, getWindow, (channel, payload) =>
    getContents()?.send(channel, payload),
  );
  registerSecurityIpc(ipcMain, services, () => agents?.notify ?? null);

  // Global summon shortcut for the JARVIS overlay (Alt+Space by default, AIOS_SUMMON_SHORTCUT to override).
  try {
    const registered = globalShortcut.register(config.summonShortcut, () => {
      if (mainWindow && !mainWindow.isDestroyed()) {
        if (mainWindow.isMinimized()) mainWindow.restore();
        mainWindow.focus();
        mainWindow.webContents.send('jarvis:toggle');
      }
    });
    setSummonRegistered(registered);
    if (!registered) {
      console.warn(
        `[ai-os] summon shortcut "${config.summonShortcut}" unavailable; using in-app binding only`,
      );
    }
  } catch (error) {
    setSummonRegistered(false);
    console.warn('[ai-os] summon shortcut registration failed:', error);
  }

  createWindow();

  app.on('activate', () => {
    if (BrowserWindow.getAllWindows().length === 0) createWindow();
  });
});

app.on('window-all-closed', () => {
  if (process.platform !== 'darwin') app.quit();
});

let ocrEngine: ReturnType<typeof createOcrEngine> | null = null;
let agentsRuntime: AgentsRuntime | null = null;
let ttsRuntime: ReturnType<typeof registerTtsIpc> | null = null;
const labManager = new LabManager();
const cameraCapturer = new CameraCapturer((id) =>
  mainWindow?.webContents.send('awareness:captureRequest', id),
);

app.on('will-quit', () => {
  void ocrEngine?.shutdown();
  agentsRuntime?.shutdown();
  ttsRuntime?.shutdown();
  labManager.shutdown();
  globalShortcut.unregisterAll();
  if (services) flushServices(services);
  shutdownSpeechEngine();
});
