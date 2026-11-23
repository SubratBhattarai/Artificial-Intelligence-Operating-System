import type { Services } from '../services';
import type { SystemMetrics } from '../../shared/protocol';
import {
  createBriefingTool,
  createCalculateTool,
  createCompleteTaskTool,
  createCreateEventTool,
  createCreateNoteTool,
  createCreateTaskTool,
  createListEventsTool,
  createListMailTool,
  createListTasksTool,
  createOpenInBrowserTool,
  createSystemMetricsTool,
} from './appTools';
import { appStatusTool } from './appStatus';
import type { AgentManager } from '../agents/agentManager';
import { createCreateMonitorTool, createSaveReportTool, createStartAgentTool } from './agentTools';
import {
  createCloseApplicationTool,
  createFetchPageTool,
  createListAppsTool,
  createOpenApplicationTool,
  createReadScreenTool,
  createRunCommandTool,
  createSetBrightnessTool,
  createSetVolumeTool,
  createWebSearchTool,
  type ScreenReader,
} from './computerTools';
import {
  createAppendToFileTool,
  createCreateFileTool,
  createEditFileTool,
  createMoveFileTool,
} from './fileTools';
import { listFolderTool } from './listFolder';
import { createProposeMemoryTool } from './proposeMemory';
import type { LabManager } from '../lab/lab';
import { createAwarenessTools, createOpenShellAppTool, type AwarenessDeps } from './awarenessTools';
import { createLabTools } from './labTools';
import { createListScenesTool } from './sceneTools';
import { createCompareDocumentsTool } from './compareDocuments';
import { createReadDocumentTool } from './readDocument';
import { ToolRegistry } from './registry';
import { createSearchFilesTool } from './searchFiles';
import { createSearchMemoryTool } from './searchMemory';

export interface RegistryExtras {
  getMetrics?: () => Promise<SystemMetrics>;
  openExternal?: (url: string) => Promise<void>;
  screen?: ScreenReader;
  /** Late-bound: the agent manager is created after the registry it uses. */
  getAgentManager?: () => AgentManager;
  lab?: LabManager;
  awareness?: AwarenessDeps;
  openShellApp?: (appId: string) => void;
}

/**
 * All tools JARVIS can call. Read-only tools run directly; the few that change data
 * (create/complete task, add event, add note) are reversible, previewed, approved and verified.
 */
export function createRegistry(services: Services, extras: RegistryExtras = {}): ToolRegistry {
  const {
    memory,
    notes,
    conversations,
    fileIndex,
    tasks,
    events,
    mail,
    audit,
    toolSettings,
    permissions,
  } = services;
  const registry = new ToolRegistry({
    audit,
    isEnabled: toolSettings.isEnabled,
    authorize: (needed) => permissions.checkTool(needed),
  })
    .register(appStatusTool)
    .register(listFolderTool)
    .register(createSearchMemoryTool({ memory, notes, conversations }))
    .register(createSearchFilesTool(fileIndex))
    .register(createReadDocumentTool(fileIndex))
    .register(createCompareDocumentsTool(fileIndex))
    .register(createProposeMemoryTool(memory))
    .register(createListTasksTool(tasks))
    .register(createListEventsTool(events))
    .register(createCreateTaskTool(tasks))
    .register(createCompleteTaskTool(tasks))
    .register(createCreateEventTool(events))
    .register(createCreateNoteTool(notes))
    .register(createListMailTool(mail))
    .register(createCalculateTool())
    .register(
      createBriefingTool({
        tasks,
        events,
        mail,
        can: (id, level) => permissions.allows(id, level),
      }),
    );
  registry
    .register(createCreateFileTool())
    .register(createMoveFileTool())
    .register(createEditFileTool())
    .register(createAppendToFileTool())
    .register(createListScenesTool(services.scenes))
    .register(createListAppsTool(services.appsAllowlist))
    .register(createOpenApplicationTool(services.appsAllowlist))
    .register(createCloseApplicationTool(services.appsAllowlist))
    .register(createRunCommandTool())
    .register(createSetVolumeTool())
    .register(createSetBrightnessTool())
    .register(createFetchPageTool())
    .register(createWebSearchTool());
  registry
    .register(createCreateMonitorTool(services.monitors))
    .register(createSaveReportTool(services.reports));
  if (extras.getAgentManager) {
    registry.register(createStartAgentTool(extras.getAgentManager, services.agentStore));
  }
  if (extras.lab) for (const tool of createLabTools(extras.lab)) registry.register(tool);
  if (extras.awareness)
    for (const tool of createAwarenessTools(extras.awareness)) registry.register(tool);
  if (extras.openShellApp) registry.register(createOpenShellAppTool(extras.openShellApp));
  if (extras.screen) registry.register(createReadScreenTool(extras.screen));
  if (extras.openExternal) registry.register(createOpenInBrowserTool(extras.openExternal));
  if (extras.getMetrics) registry.register(createSystemMetricsTool(extras.getMetrics));
  return registry;
}

export { ToolRegistry } from './registry';
export type { Tool, ToolSchema, ToolExecutionContext } from './types';
