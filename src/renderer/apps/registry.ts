import { createElement } from 'react';
import {
  ActivityIcon,
  AgentsIcon,
  BriefingIcon,
  BrainIcon,
  ShieldIcon,
  DocumentsIcon,
  ScenesIcon,
  CalculatorIcon,
  CalendarIcon,
  CameraIcon,
  MailIcon,
  FilesIcon,
  FinanceIcon,
  MemoryIcon,
  MonitorIcon,
  NotesIcon,
  SettingsIcon,
  StatusIcon,
  TasksIcon,
} from '../components/Icons';
import { ActivityApp } from './ActivityApp';
import { AgentsApp } from './AgentsApp';
import { BriefingApp } from './BriefingApp';
import { SecondBrainApp } from './SecondBrainApp';
import { SecurityApp } from './SecurityApp';
import { DocumentsApp } from './DocumentsApp';
import { ScenesApp } from './ScenesApp';
import { LabApp } from './LabApp';
import { CalculatorApp } from './CalculatorApp';
import { CameraApp } from './CameraApp';
import { MailApp } from './MailApp';
import { CalendarApp } from './CalendarApp';
import { FinanceApp } from './FinanceApp';
import { MonitorApp } from './MonitorApp';
import { TasksApp } from './TasksApp';
import { FilesApp } from './FilesApp';
import { MemoryApp } from './MemoryApp';
import { NotesApp } from './NotesApp';
import { SettingsApp } from './SettingsApp';
import { StatusApp } from './StatusApp';
import type { ShellApp } from './types';

/**
 * The shell app registry. Adding a built-in app = one entry here; the shell handles
 * windows, focus, persistence and dock/launcher placement automatically.
 * (Plain .ts file, so icons are built with createElement rather than JSX.)
 */
export const SHELL_APPS: ShellApp[] = [
  {
    id: 'status',
    title: 'Status',
    description: 'Live health of the shell, model provider and registered tools',
    icon: createElement(StatusIcon),
    defaultSize: { width: 760, height: 520 },
    singleton: true,
    defaultOpen: true,
    Component: StatusApp,
  },
  {
    id: 'files',
    title: 'Files',
    description: 'Browse, index, search and ask questions about folders you choose',
    icon: createElement(FilesIcon),
    defaultSize: { width: 980, height: 640 },
    singleton: true,
    Component: FilesApp,
  },
  {
    id: 'memory',
    title: 'Memory',
    description: 'Inspect, edit, search, export and delete what JARVIS remembers',
    icon: createElement(MemoryIcon),
    defaultSize: { width: 900, height: 620 },
    singleton: true,
    Component: MemoryApp,
  },
  {
    id: 'notes',
    title: 'Notes',
    description: 'A local scratchpad that autosaves',
    icon: createElement(NotesIcon),
    defaultSize: { width: 560, height: 440 },
    singleton: false,
    Component: NotesApp,
  },
  {
    id: 'tasks',
    title: 'Tasks',
    description: 'A to-do list that works on its own; JARVIS can add tasks you approve',
    icon: createElement(TasksIcon),
    defaultSize: { width: 640, height: 560 },
    singleton: true,
    Component: TasksApp,
  },
  {
    id: 'calendar',
    title: 'Calendar',
    description: 'Month view and agenda; import and export .ics files',
    icon: createElement(CalendarIcon),
    defaultSize: { width: 920, height: 620 },
    singleton: true,
    Component: CalendarApp,
  },
  {
    id: 'finance',
    title: 'Finance',
    description: 'Manual ledger with CSV import and monthly summary; never moves money',
    icon: createElement(FinanceIcon),
    defaultSize: { width: 820, height: 640 },
    singleton: true,
    Component: FinanceApp,
  },
  {
    id: 'lab',
    title: 'Engineering Lab',
    description: 'Build, test and preview small projects locally; nothing is deployed online',
    icon: createElement(DocumentsIcon),
    defaultSize: { width: 720, height: 680 },
    singleton: true,
    Component: LabApp,
  },
  {
    id: 'scenes',
    title: 'Focus & Scenes',
    description: 'Focus timer and one-phrase setups such as Study mode',
    icon: createElement(ScenesIcon),
    defaultSize: { width: 640, height: 680 },
    singleton: true,
    Component: ScenesApp,
  },
  {
    id: 'documents',
    title: 'Documents',
    description:
      'Drop in PDFs, Word, Excel, PowerPoint or images to summarize, question and compare',
    icon: createElement(DocumentsIcon),
    defaultSize: { width: 700, height: 660 },
    singleton: true,
    Component: DocumentsApp,
  },
  {
    id: 'security',
    title: 'Security Center',
    description: 'See running programs, network activity and Windows protection (read-only)',
    icon: createElement(ShieldIcon),
    defaultSize: { width: 700, height: 660 },
    singleton: true,
    Component: SecurityApp,
  },
  {
    id: 'secondbrain',
    title: 'Second Brain',
    description: 'Search notes, ideas, documents and conversations in one place',
    icon: createElement(BrainIcon),
    defaultSize: { width: 720, height: 640 },
    singleton: true,
    Component: SecondBrainApp,
  },
  {
    id: 'briefing',
    title: 'Briefing',
    description: 'Your daily briefing: schedule, mail, weather, news, deadlines and tasks',
    icon: createElement(BriefingIcon),
    defaultSize: { width: 620, height: 680 },
    singleton: true,
    Component: BriefingApp,
  },
  {
    id: 'agents',
    title: 'Agents',
    description: 'Watch background agents work, monitor websites, and read reports',
    icon: createElement(AgentsIcon),
    defaultSize: { width: 940, height: 640 },
    singleton: true,
    Component: AgentsApp,
  },
  {
    id: 'mail',
    title: 'Mail',
    description: 'A private mailbox inside AI OS; nothing leaves the app',
    icon: createElement(MailIcon),
    defaultSize: { width: 820, height: 600 },
    singleton: true,
    Component: MailApp,
  },
  {
    id: 'calculator',
    title: 'Calculator',
    description: 'Quick, safe arithmetic',
    icon: createElement(CalculatorIcon),
    defaultSize: { width: 340, height: 560 },
    singleton: true,
    Component: CalculatorApp,
  },
  {
    id: 'camera',
    title: 'Camera',
    description: 'Take photos stored only inside AI OS; off until you allow it',
    icon: createElement(CameraIcon),
    defaultSize: { width: 720, height: 640 },
    singleton: true,
    Component: CameraApp,
  },
  {
    id: 'monitor',
    title: 'Monitor',
    description: 'Live CPU, memory, disk and AI OS process usage',
    icon: createElement(MonitorIcon),
    defaultSize: { width: 620, height: 600 },
    singleton: true,
    Component: MonitorApp,
  },
  {
    id: 'activity',
    title: 'Activity',
    description: 'Audit log of every JARVIS tool call, plus per-tool switches',
    icon: createElement(ActivityIcon),
    defaultSize: { width: 780, height: 560 },
    singleton: true,
    Component: ActivityApp,
  },
  {
    id: 'settings',
    title: 'Settings',
    description: 'Shortcuts, provider info and local data controls',
    icon: createElement(SettingsIcon),
    defaultSize: { width: 700, height: 560 },
    singleton: true,
    Component: SettingsApp,
  },
];

export function getShellApp(appId: string): ShellApp | undefined {
  return SHELL_APPS.find((app) => app.id === appId);
}

export function listShellApps(): ShellApp[] {
  return SHELL_APPS;
}
