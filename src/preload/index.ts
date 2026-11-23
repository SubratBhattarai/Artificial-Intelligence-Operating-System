import { contextBridge, ipcRenderer, webFrame, webUtils } from 'electron';
import type {
  AgentEvent,
  AgentKind,
  AgentRecord,
  MonitorRecord,
  NotificationItem,
  ReportRecord,
} from '../shared/agents';
import type { ApprovedApp as ApprovedAppInfo } from '../shared/platform';
import type { LabProject, LabRunResult } from '../shared/lab';
import type { MissionEvent, MissionRecord } from '../shared/missions';
import type { Scene, SceneStep } from '../shared/scenes';
import type { TtsAudio, TtsQuality, TtsStatus } from '../shared/tts';
import type { SecurityReport } from '../shared/security';
import type { Briefing, BriefingSettings } from '../shared/briefing';
import type { MailFolder, MailInput, MailMessage } from '../shared/mail';
import type { PermissionId, PermissionLevel, PermissionMap } from '../shared/permissions';
import type {
  BackupResult,
  CleanupActionId,
  CleanupResult,
  PhotoInfo,
  RestorePreview,
  StorageReport,
} from '../shared/platform';
import type {
  EventInput,
  EventPatch,
  EventRecord,
  ImportResult,
  MonitorSnapshot,
  TaskInput,
  TaskPatch,
  TaskRecord,
  TaskStatus,
  TransactionInput,
  TransactionPatch,
  TransactionRecord,
  FinanceSummary,
} from '../shared/apps';
import type {
  ApprovalInfo,
  AuditRecord,
  AskDocsRequest,
  ContextGrant,
  Conversation,
  ConversationSummary,
  DocsEvent,
  ExportResult,
  FileIndexOverview,
  FileListingResult,
  FilePreview,
  FileSearchHit,
  Health,
  IndexProgress,
  JarvisEvent,
  MemoryInput,
  MemoryPatch,
  MemoryRecord,
  MemorySettings,
  MemorySourceSummary,
  NoteRecord,
  SearchHit,
  SearchHitKind,
  StartChatRequest,
  ToolDescriptor,
  TranscribeResult,
  VoiceConfig,
  VoiceProgress,
  SystemMetrics,
} from '../shared/protocol';

/** Invoke a main-process handler and surface just its message (no Electron wrapper text). */
function call<T>(channel: string, ...args: unknown[]): Promise<T> {
  return ipcRenderer.invoke(channel, ...args).catch((error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    throw new Error(message.replace(/^Error invoking remote method '[^']+': (Error: )?/, ''));
  }) as Promise<T>;
}

function subscribe<T>(channel: string, handler: (payload: T) => void): () => void {
  const listener = (_event: unknown, payload: T) => handler(payload);
  ipcRenderer.on(channel, listener);
  return () => ipcRenderer.removeListener(channel, listener);
}

/**
 * The only bridge between renderer and main. Note what is absent: no process.env, no fs writes,
 * no shell. Secrets (provider keys) never cross this boundary in either direction.
 */
const api = {
  getHealth: (): Promise<Health> => call('system:health'),
  listTools: (): Promise<ToolDescriptor[]> => call('system:tools'),
  getMetrics: (): Promise<SystemMetrics> => call('system:metrics'),
  listFolder: (target?: string): Promise<FileListingResult> => call('fs:list', target),

  reportShellState: (snapshot: unknown): void => ipcRenderer.send('shell:state', snapshot),

  chat: {
    start: (request: StartChatRequest): Promise<{ requestId: string }> =>
      call('chat:start', request),
    cancel: (requestId: string): Promise<boolean> => call('chat:cancel', requestId),
    onEvent: (handler: (event: JarvisEvent) => void): (() => void) =>
      subscribe('jarvis:event', handler),
  },

  memory: {
    list: (options?: { includeExpired?: boolean }): Promise<MemoryRecord[]> =>
      call('memory:list', options),
    add: (input: MemoryInput): Promise<MemoryRecord> => call('memory:add', input),
    update: (id: string, patch: MemoryPatch): Promise<MemoryRecord> =>
      call('memory:update', id, patch),
    approve: (id: string): Promise<MemoryRecord> => call('memory:approve', id),
    remove: (id: string): Promise<boolean> => call('memory:remove', id),
    removeBySource: (key: string): Promise<number> => call('memory:removeBySource', key),
    sources: (): Promise<MemorySourceSummary[]> => call('memory:sources'),
    purgeExpired: (): Promise<number> => call('memory:purgeExpired'),
    clearAll: (): Promise<number> => call('memory:clearAll'),
    getSettings: (): Promise<MemorySettings> => call('memory:getSettings'),
    setSettings: (patch: Partial<MemorySettings>): Promise<MemorySettings> =>
      call('memory:setSettings', patch),
    exportAll: (): Promise<ExportResult> => call('memory:export'),
  },

  notes: {
    list: (): Promise<NoteRecord[]> => call('notes:list'),
    create: (body?: string): Promise<NoteRecord> => call('notes:create', body),
    update: (id: string, body: string): Promise<NoteRecord> => call('notes:update', id, body),
    remove: (id: string): Promise<boolean> => call('notes:remove', id),
  },

  conversations: {
    list: (): Promise<ConversationSummary[]> => call('conversations:list'),
    get: (id: string): Promise<Conversation | null> => call('conversations:get', id),
    remove: (id: string): Promise<boolean> => call('conversations:remove', id),
    clearAll: (): Promise<number> => call('conversations:clearAll'),
  },

  search: {
    all: (query: string, kinds?: SearchHitKind[]): Promise<SearchHit[]> =>
      call('search:all', query, kinds),
  },

  files: {
    /** Path of a file dragged into the window, and permission to read that one file this session. */
    pathFor: (file: File): string => webUtils.getPathForFile(file),
    allowDropped: (paths: string[]): Promise<string[]> => call('files:allow-dropped', paths),
    overview: (): Promise<FileIndexOverview> => call('files:overview'),
    pickFolder: (): Promise<{ added: string | null }> => call('files:pickFolder'),
    removeFolder: (folder: string): Promise<{ removedFiles: number }> =>
      call('files:removeFolder', folder),
    reindex: (folder?: string): Promise<{ started: boolean }> => call('files:reindex', folder),
    cancelIndex: (): Promise<boolean> => call('files:cancelIndex'),
    search: (query: string, limit?: number): Promise<FileSearchHit[]> =>
      call('files:search', query, limit),
    preview: (target: string): Promise<FilePreview> => call('files:preview', target),
    open: (target: string): Promise<boolean> => call('files:open', target),
    reveal: (target: string): Promise<boolean> => call('files:reveal', target),
    onProgress: (handler: (progress: IndexProgress) => void): (() => void) =>
      subscribe('files:progress', handler),
  },

  docs: {
    ask: (request: AskDocsRequest): Promise<{ requestId: string }> => call('docs:ask', request),
    cancel: (requestId: string): Promise<boolean> => call('docs:cancel', requestId),
    onEvent: (handler: (event: DocsEvent) => void): (() => void) =>
      subscribe('docs:event', handler),
  },

  voice: {
    config: (): Promise<VoiceConfig> => call('voice:config'),
    transcribe: (audio: Float32Array): Promise<TranscribeResult> => call('voice:transcribe', audio),
    prepare: (): Promise<{ ok: boolean; error?: string }> => call('voice:prepare'),
    keepWarm: (on: boolean): Promise<boolean> => call('voice:keep-warm', on),
    unload: (): Promise<boolean> => call('voice:unload'),
    setKeepLoaded: (on: boolean): Promise<VoiceConfig> => call('voice:set-keep-loaded', on),
    setModel: (model: string): Promise<VoiceConfig> => call('voice:set-model', model),
    onProgress: (handler: (progress: VoiceProgress) => void): (() => void) =>
      subscribe('voice:progress', handler),
  },

  tools: {
    decide: (approvalId: string, approve: boolean): Promise<boolean> =>
      call('tools:decide', approvalId, approve),
    pending: (): Promise<ApprovalInfo[]> => call('tools:pending'),
    setEnabled: (name: string, enabled: boolean): Promise<ToolDescriptor[]> =>
      call('tools:set-enabled', name, enabled),
  },

  audit: {
    list: (): Promise<AuditRecord[]> => call('audit:list'),
    clear: (): Promise<number> => call('audit:clear'),
  },

  tasks: {
    list: (): Promise<TaskRecord[]> => call('tasks:list'),
    create: (input: TaskInput): Promise<TaskRecord> => call('tasks:create', input),
    update: (id: string, patch: TaskPatch): Promise<TaskRecord> => call('tasks:update', id, patch),
    setStatus: (id: string, status: TaskStatus): Promise<TaskRecord> =>
      call('tasks:set-status', id, status),
    remove: (id: string): Promise<boolean> => call('tasks:remove', id),
  },

  events: {
    list: (range?: { from?: number; to?: number }): Promise<EventRecord[]> =>
      call('events:list', range),
    create: (input: EventInput): Promise<EventRecord> => call('events:create', input),
    update: (id: string, patch: EventPatch): Promise<EventRecord> =>
      call('events:update', id, patch),
    remove: (id: string): Promise<boolean> => call('events:remove', id),
    importIcs: (): Promise<ImportResult> => call('events:import-ics'),
    exportIcs: (): Promise<ExportResult> => call('events:export-ics'),
  },

  finance: {
    list: (month?: string): Promise<TransactionRecord[]> => call('finance:list', month),
    create: (input: TransactionInput): Promise<TransactionRecord> => call('finance:create', input),
    update: (id: string, patch: TransactionPatch): Promise<TransactionRecord> =>
      call('finance:update', id, patch),
    remove: (id: string): Promise<boolean> => call('finance:remove', id),
    summary: (month: string): Promise<FinanceSummary> => call('finance:summary', month),
    importCsv: (): Promise<ImportResult> => call('finance:import-csv'),
    exportCsv: (): Promise<ExportResult> => call('finance:export-csv'),
  },

  monitor: {
    snapshot: (): Promise<MonitorSnapshot> => call('monitor:snapshot'),
  },

  permissions: {
    get: (): Promise<PermissionMap> => call('permissions:get'),
    set: (id: PermissionId, level: PermissionLevel): Promise<PermissionMap> =>
      call('permissions:set', id, level),
    revokeAll: (): Promise<PermissionMap> => call('permissions:revoke-all'),
  },

  awareness: {
    onCaptureRequest: (handler: (id: string) => void): (() => void) =>
      subscribe('awareness:captureRequest', handler),
    scan: (
      dataUrl: string,
      question?: string,
    ): Promise<{ description: string; visibleText: string; model: string }> =>
      call('awareness:scan', dataUrl, question),
    onOpenApp: (handler: (appId: string) => void): (() => void) =>
      subscribe('shell:openApp', handler),
    sendCapture: (id: string, dataUrl: string | null, error?: string): Promise<void> =>
      call('awareness:captureResult', id, dataUrl, error),
  },

  lab: {
    list: (): Promise<LabProject[]> => call('lab:list'),
    create: (name: string, template: string): Promise<LabProject[]> =>
      call('lab:create', name, template),
    run: (project: string, command: string): Promise<LabRunResult> =>
      call('lab:run', project, command),
    preview: (project: string, start: boolean): Promise<LabProject[]> =>
      call('lab:preview', project, start),
    openPreview: (project: string): Promise<void> => call('lab:openPreview', project),
  },

  missions: {
    list: (): Promise<MissionRecord[]> => call('missions:list'),
    create: (objective: string): Promise<MissionRecord> => call('missions:create', objective),
    approve: (id: string): Promise<MissionRecord> => call('missions:approve', id),
    pause: (id: string): Promise<void> => call('missions:pause', id),
    resume: (id: string): Promise<void> => call('missions:resume', id),
    cancel: (id: string): Promise<void> => call('missions:cancel', id),
    remove: (id: string): Promise<MissionRecord[]> => call('missions:remove', id),
    onEvent: (handler: (event: MissionEvent) => void): (() => void) =>
      subscribe('missions:event', handler),
  },

  scenes: {
    list: (): Promise<Scene[]> => call('scenes:list'),
    save: (scene: { id?: string; name: string; steps: SceneStep[] }): Promise<Scene[]> =>
      call('scenes:save', scene),
    remove: (id: string): Promise<Scene[]> => call('scenes:remove', id),
  },

  tts: {
    status: (): Promise<TtsStatus> => call('tts:status'),
    install: (): Promise<TtsStatus> => call('tts:install'),
    cancelInstall: (): Promise<boolean> => call('tts:cancel-install'),
    configure: (settings: { quality?: TtsQuality; enabled?: boolean }): Promise<TtsStatus> =>
      call('tts:configure', settings),
    setReference: (transcript: string): Promise<TtsStatus> => call('tts:set-reference', transcript),
    speak: (text: string): Promise<TtsAudio> => call('tts:speak', text),
    stop: (): Promise<TtsStatus> => call('tts:stop'),
    onStatus: (handler: (status: TtsStatus) => void): (() => void) =>
      subscribe('tts:status', handler),
  },

  security: {
    scan: (): Promise<SecurityReport> => call('security:scan'),
    last: (): Promise<SecurityReport | null> => call('security:last'),
  },

  briefing: {
    get: (): Promise<Briefing> => call('briefing:get'),
    settings: (): Promise<BriefingSettings> => call('briefing:settings'),
    saveSettings: (settings: BriefingSettings): Promise<BriefingSettings> =>
      call('briefing:save-settings', settings),
    launchDue: (): Promise<boolean> => call('briefing:launch-due'),
  },

  agents: {
    list: (): Promise<AgentRecord[]> => call('agents:list'),
    start: (goal: string, kind: AgentKind): Promise<AgentRecord> =>
      call('agents:start', goal, kind),
    cancel: (id: string): Promise<boolean> => call('agents:cancel', id),
    clearFinished: (): Promise<AgentRecord[]> => call('agents:clear-finished'),
    onEvent: (handler: (event: AgentEvent) => void): (() => void) =>
      subscribe('agents:event', handler),
  },
  reports: {
    list: (): Promise<ReportRecord[]> => call('reports:list'),
    remove: (id: string): Promise<boolean> => call('reports:delete', id),
    export: (id: string): Promise<{ ok: boolean; canceled?: boolean; path?: string }> =>
      call('reports:export', id),
  },
  monitors: {
    list: (): Promise<MonitorRecord[]> => call('monitors:list'),
    add: (input: {
      url: string;
      label?: string;
      intervalMinutes?: number;
    }): Promise<MonitorRecord> => call('monitors:add', input),
    remove: (id: string): Promise<boolean> => call('monitors:remove', id),
    check: (id: string): Promise<MonitorRecord[]> => call('monitors:check', id),
    seen: (id: string): Promise<MonitorRecord[]> => call('monitors:seen', id),
  },
  notifications: {
    list: (): Promise<NotificationItem[]> => call('notifications:list'),
    read: (id: string): Promise<NotificationItem[]> => call('notifications:read', id),
    readAll: (): Promise<NotificationItem[]> => call('notifications:read-all'),
    clear: (): Promise<NotificationItem[]> => call('notifications:clear'),
    scan: (): Promise<NotificationItem[]> => call('notifications:scan'),
    onNew: (handler: (item: NotificationItem) => void): (() => void) =>
      subscribe('notifications:new', handler),
  },
  approvedApps: {
    list: (): Promise<ApprovedAppInfo[]> => call('apps-allow:list'),
    add: (): Promise<ApprovedAppInfo[]> => call('apps-allow:add'),
    remove: (id: string): Promise<ApprovedAppInfo[]> => call('apps-allow:remove', id),
  },
  onScreenActivity: (handler: (active: boolean) => void): (() => void) =>
    subscribe('screen:activity', handler),
  mail: {
    list: (folder?: MailFolder): Promise<MailMessage[]> => call('mail:list', folder),
    unread: (): Promise<number> => call('mail:unread'),
    compose: (input: MailInput): Promise<MailMessage> => call('mail:compose', input),
    setUnread: (id: string, unread: boolean): Promise<MailMessage> =>
      call('mail:set-unread', id, unread),
    remove: (id: string): Promise<boolean> => call('mail:remove', id),
    importFile: (): Promise<ImportResult> => call('mail:import'),
  },

  photos: {
    list: (): Promise<PhotoInfo[]> => call('photos:list'),
    save: (dataUrl: string): Promise<PhotoInfo> => call('photos:save', dataUrl),
    read: (name: string): Promise<string> => call('photos:read', name),
    remove: (name: string): Promise<boolean> => call('photos:remove', name),
  },

  storage: {
    report: (): Promise<StorageReport> => call('storage:report'),
    cleanup: (ids: CleanupActionId[]): Promise<CleanupResult> => call('storage:cleanup', ids),
    freeMemory: (): Promise<boolean> => call('storage:free-memory'),
    exportBackup: (): Promise<BackupResult> => call('backup:export'),
    chooseBackup: (): Promise<RestorePreview> => call('backup:choose'),
    restoreBackup: (token: string): Promise<{ restored: string[]; safetyCopy: string }> =>
      call('backup:restore', token),
    wipeAll: (confirm: string): Promise<boolean> => call('data:wipe-all', confirm),
  },

  display: {
    /** Whole-UI scale (0.8 – 1.5). */
    setZoom: (factor: number): void => {
      if (Number.isFinite(factor)) webFrame.setZoomFactor(Math.min(1.5, Math.max(0.8, factor)));
    },
    getZoom: (): number => webFrame.getZoomFactor(),
  },

  context: {
    get: (): Promise<ContextGrant> => call('context:get'),
    set: (patch: { windows?: boolean }): Promise<ContextGrant> => call('context:set', patch),
  },

  onSummon: (handler: () => void): (() => void) => subscribe('jarvis:toggle', handler),
};

export type AiosApi = typeof api;

contextBridge.exposeInMainWorld('aios', api);
