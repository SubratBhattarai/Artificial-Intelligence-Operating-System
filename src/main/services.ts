import path from 'node:path';
import { flushAllJsonFiles } from './store/jsonFile';
import { setSelectedRoots } from './fs/allowed';
import { FileIndex } from './files/indexer';
import { MailStore } from './apps/mailStore';
import { PermissionStore } from './permissions/permissionStore';
import { EventStore } from './apps/eventStore';
import { SceneStore } from './apps/sceneStore';
import { AppsAllowlist } from './apps/appsAllowlist';
import { AgentStore, MonitorStore, NotificationStore, ReportStore } from './agents/stores';
import { FinanceStore } from './apps/financeStore';
import { TaskStore } from './apps/taskStore';
import { ApprovalBroker } from './tools/approvals';
import { AuditStore } from './tools/audit';
import { ToolSettings } from './tools/toolSettings';
import { ConversationStore } from './memory/conversationStore';
import { MemoryStore } from './memory/memoryStore';
import { NoteStore } from './memory/noteStore';

/** Everything that persists user data locally. Created once at startup; owns no Electron APIs. */
export interface Services {
  dataDir: string;
  memory: MemoryStore;
  notes: NoteStore;
  conversations: ConversationStore;
  fileIndex: FileIndex;
  tasks: TaskStore;
  events: EventStore;
  mail: MailStore;
  permissions: PermissionStore;
  finance: FinanceStore;
  appsAllowlist: AppsAllowlist;
  scenes: SceneStore;
  agentStore: AgentStore;
  reports: ReportStore;
  monitors: MonitorStore;
  notifications: NotificationStore;
  audit: AuditStore;
  toolSettings: ToolSettings;
  /** In-memory: pending approvals only the user's click can resolve. */
  approvals: ApprovalBroker;
}

export function createServices(dataDir: string): Services {
  return {
    dataDir,
    memory: new MemoryStore(dataDir),
    notes: new NoteStore(dataDir),
    conversations: new ConversationStore(dataDir),
    // Folders the user explicitly picked become browsable, in addition to the defaults.
    fileIndex: new FileIndex(path.join(dataDir), { onFoldersChanged: setSelectedRoots }),
    tasks: new TaskStore(dataDir),
    events: new EventStore(dataDir),
    mail: new MailStore(dataDir),
    permissions: new PermissionStore(dataDir),
    finance: new FinanceStore(dataDir),
    appsAllowlist: new AppsAllowlist(dataDir),
    scenes: new SceneStore(dataDir),
    agentStore: new AgentStore(dataDir),
    reports: new ReportStore(dataDir),
    monitors: new MonitorStore(dataDir),
    notifications: new NotificationStore(dataDir),
    audit: new AuditStore(dataDir),
    toolSettings: new ToolSettings(dataDir),
    approvals: new ApprovalBroker(),
  };
}

export function flushServices(services: Services): void {
  services.memory.flush();
  services.notes.flush();
  services.conversations.flush();
  services.fileIndex.flush();
  services.tasks.flush();
  services.events.flush();
  services.mail.flush();
  services.permissions.flush();
  services.finance.flush();
  services.audit.flush();
  services.toolSettings.flush();
  // Everything else (apps list, agents, reports, monitors, notifications, voice settings).
  flushAllJsonFiles();
}
