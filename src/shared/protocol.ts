/**
 * Types shared between the Electron main process, preload and renderer.
 * This module must stay free of Node/Electron imports — it is bundled into the renderer.
 */

export type ProviderId = 'ollama' | 'openai';

export interface ProviderStatus {
  id: ProviderId | 'unknown';
  model: string | null;
  /** Adapter can be constructed from environment configuration (e.g. an API key exists). */
  configured: boolean;
  /** Result of a lightweight reachability ping; null when the provider was not pingable. */
  reachable: boolean | null;
}

export interface Health {
  status: 'ok' | 'degraded';
  appVersion: string;
  platform: string;
  uptimeMs: number;
  provider: ProviderStatus;
  tools: string[];
  summonShortcut: { accelerator: string; registered: boolean };
  checkedAt: number;
}

export type ChatRole = 'user' | 'assistant' | 'tool' | 'system';

export interface ChatMessage {
  id: string;
  role: ChatRole;
  content: string;
  createdAt: number;
  /** Assistant message terminated by an error rather than a model finish. */
  error?: boolean;
}

export interface ToolCallInfo {
  id: string;
  name: string;
  /** JSON-encoded arguments string, as produced by the model. */
  arguments: string;
}

export type JarvisEvent =
  | { type: 'start'; requestId: string }
  | { type: 'text'; requestId: string; text: string }
  | { type: 'tool_call'; requestId: string; call: ToolCallInfo }
  | {
      type: 'tool_result';
      requestId: string;
      call: ToolCallInfo;
      ok: boolean;
      preview: string;
      status?: ToolStatus;
      detail?: string;
    }
  | { type: 'approval_request'; requestId: string; approval: ApprovalInfo }
  | {
      type: 'approval_resolved';
      requestId: string;
      approvalId: string;
      decision: 'approved' | 'denied' | 'expired' | 'cancelled';
    }
  | { type: 'done'; requestId: string; finishReason: string }
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId: string; message: string; code?: string };

export type OutgoingChatMessage = { role: 'user' | 'assistant'; content: string };

export interface StartChatRequest {
  requestId: string;
  /** Conversation session this turn belongs to (stored locally with timestamps). */
  sessionId?: string;
  messages: OutgoingChatMessage[];
}

/** read = observes only · low = reversible local change · medium/high = reserved, always approved. */
export type RiskTier = 'read' | 'low' | 'medium' | 'high';

/**
 * How a tool call ended. Only `completed` (read-only) and `verified` (a change that was read back
 * and confirmed) count as success.
 */
export type ToolStatus =
  | 'completed'
  | 'verified'
  | 'not_verified'
  | 'failed'
  | 'rolled_back'
  | 'denied'
  | 'rejected'
  | 'cancelled';

/** Lifecycle of one action: proposed → awaiting_approval → executing → one of the final three. */
export type ActionState =
  'proposed' | 'awaiting_approval' | 'executing' | 'succeeded' | 'failed' | 'cancelled';

export interface ApprovalInfo {
  id: string;
  tool: string;
  riskTier: RiskTier;
  title: string;
  /** Plain-language description of exactly what will happen. */
  lines: string[];
  expiresAt: number;
}

export interface ToolDescriptor {
  name: string;
  description: string;
  parameters: { type: 'object'; properties: Record<string, unknown>; required?: string[] };
  riskTier?: RiskTier;
  permissions?: string[];
  timeoutMs?: number;
  needsApproval?: boolean;
  enabled?: boolean;
}

export type AuditOutcome = ToolStatus | 'expired' | 'timeout';

export interface AuditStage {
  stage: string;
  at: number;
  note?: string;
}

export interface AuditRecord {
  id: string;
  at: number;
  sessionId?: string;
  tool: string;
  riskTier: RiskTier;
  permissions: string[];
  /** The exact arguments, truncated. */
  args: string;
  approval: 'not_required' | 'approved' | 'denied' | 'expired' | 'cancelled';
  outcome: AuditOutcome;
  /** Final lifecycle state (absent on records written before it existed). */
  state?: ActionState;
  /** Same tool + arguments + session ⇒ same key; a retried change is recognised, not repeated. */
  idempotencyKey?: string;
  detail: string;
  durationMs: number;
  stages: AuditStage[];
}

export interface FolderEntry {
  name: string;
  type: 'file' | 'directory' | 'other';
  size: number;
  modifiedAt: number;
  /** Set when the file is known to the file index. */
  indexStatus?: IndexStatus | null;
  indexReason?: string;
}

export interface FolderListing {
  path: string;
  parent: string | null;
  roots: string[];
  entries: FolderEntry[];
  truncated: boolean;
}

/** What the Files app receives: the folder listing, entries annotated with their index status. */
export type FileListingResult = FolderListing;

export type ShellWindowState = 'normal' | 'minimized' | 'maximized';

export interface ShellWindowSnapshot {
  id: string;
  appId: string;
  title: string;
  state: ShellWindowState;
  focused: boolean;
}

export interface ShellSnapshot {
  windows: ShellWindowSnapshot[];
  activeAppId: string | null;
  updatedAt: number;
}

/* ------------------------------------------------------------------ */
/* Phase 3 — conversations, memory records, notes, search              */
/* ------------------------------------------------------------------ */

export type MemorySourceKind = 'manual' | 'conversation' | 'suggested' | 'import';

export interface MemorySource {
  kind: MemorySourceKind;
  /** Conversation session the fact came from, when applicable. */
  sessionId?: string;
  /** Human-readable origin, e.g. "Added by you" or the conversation title. */
  label: string;
}

/** `pending` = suggested by JARVIS and waiting for the user's approval; never used until approved. */
export type MemoryStatus = 'active' | 'pending';

export interface MemoryRecord {
  id: string;
  fact: string;
  source: MemorySource;
  createdAt: number;
  updatedAt: number;
  /** 0..1 — how sure we are the fact is right. */
  confidence: number;
  /** Epoch ms after which the fact is ignored and eligible for purge; null = never expires. */
  expiresAt: number | null;
  status: MemoryStatus;
}

export interface MemoryInput {
  fact: string;
  confidence?: number;
  expiresAt?: number | null;
}

export interface MemoryPatch {
  fact?: string;
  confidence?: number;
  expiresAt?: number | null;
}

export interface MemorySourceSummary {
  key: string;
  kind: MemorySourceKind;
  label: string;
  sessionId?: string;
  count: number;
}

export interface MemorySettings {
  /** Include active memory facts in JARVIS's context. */
  injectIntoPrompt: boolean;
}

export interface NoteRecord {
  id: string;
  title: string;
  body: string;
  createdAt: number;
  updatedAt: number;
}

export interface ConversationMessage {
  id: string;
  role: 'user' | 'assistant';
  content: string;
  createdAt: number;
}

export interface ConversationSummary {
  /** Session id. */
  id: string;
  title: string;
  summary: string;
  createdAt: number;
  updatedAt: number;
  messageCount: number;
}

export interface Conversation extends ConversationSummary {
  messages: ConversationMessage[];
}

export type SearchHitKind = 'memory' | 'note' | 'conversation';

export interface SearchHit {
  kind: SearchHitKind;
  id: string;
  title: string;
  snippet: string;
  score: number;
  createdAt: number;
  updatedAt: number;
}

export interface MemoryExport {
  version: 1;
  exportedAt: number;
  settings: MemorySettings;
  memories: MemoryRecord[];
  notes: NoteRecord[];
  conversations: Conversation[];
}

export interface ExportResult {
  ok: boolean;
  path?: string;
  canceled?: boolean;
  error?: string;
}

/* ------------------------------------------------------------------ */
/* Phase 4 — file index, search, document Q&A                          */
/* ------------------------------------------------------------------ */

export type IndexStatus = 'indexed' | 'unreadable' | 'unsupported' | 'skipped';

export interface IndexedFile {
  id: string;
  path: string;
  name: string;
  ext: string;
  size: number;
  mtimeMs: number;
  /** SHA-1 of the content for indexed files; identical hashes mean duplicate files. */
  hash: string | null;
  status: IndexStatus;
  /** Why a file is unreadable / unsupported / skipped. */
  reason?: string;
  chunkCount: number;
  indexedAt: number;
}

export interface IndexedFolder {
  path: string;
  addedAt: number;
  lastIndexedAt: number | null;
}

export interface IndexProgress {
  phase: 'idle' | 'scanning' | 'done' | 'cancelled' | 'error';
  folder: string | null;
  scanned: number;
  indexed: number;
  unchanged: number;
  unreadable: number;
  removed: number;
  message?: string;
}

export interface FileIndexOverview {
  folders: IndexedFolder[];
  totals: {
    files: number;
    indexed: number;
    unreadable: number;
    unsupported: number;
    skipped: number;
    chunks: number;
    duplicateGroups: number;
  };
  progress: IndexProgress;
  /** Files that could not be read or were skipped (capped). */
  problems: IndexedFile[];
}

export interface FileSearchHit {
  fileId: string;
  chunkId: string;
  path: string;
  name: string;
  modifiedAt: number;
  size: number;
  /** Page, heading or line range the snippet comes from. */
  section: string;
  snippet: string;
  score: number;
  /** Other paths holding identical content. */
  duplicates: string[];
}

export interface FilePreview {
  path: string;
  name: string;
  size: number;
  modifiedAt: number;
  kind: 'text' | 'image' | 'unsupported' | 'error';
  text?: string;
  truncated?: boolean;
  dataUrl?: string;
  error?: string;
}

export interface DocSource {
  /** Citation number used in the answer, e.g. [1]. */
  n: number;
  chunkId: string;
  path: string;
  name: string;
  section: string;
  snippet: string;
  modifiedAt: number;
}

export interface DocUnreadable {
  path: string;
  name: string;
  reason: string;
}

export interface AskDocsRequest {
  requestId: string;
  question: string;
}

export type DocsEvent =
  | { type: 'sources'; requestId: string; sources: DocSource[]; unreadable: DocUnreadable[] }
  | { type: 'text'; requestId: string; text: string }
  | { type: 'done'; requestId: string }
  | { type: 'cancelled'; requestId: string }
  | { type: 'error'; requestId: string; message: string };

/* ------------------------------------------------------------------ */
/* Phase 5 — voice and session-scoped context                          */
/* ------------------------------------------------------------------ */

export interface VoiceConfig {
  sttConfigured: boolean;
  sttModel: string;
  /** True when the transcription endpoint is on this machine (audio never leaves it). */
  sttLocal: boolean;
  /** True once the speech model is stored on this machine (first use downloads it once). */
  modelCached: boolean;
  /** Folder the model files are stored in, shown so the user can see it is local. */
  cacheDir: string;
  /** The model stays in memory so it never reloads. */
  keepLoaded: boolean;
  /** The model is in memory right now. */
  loaded: boolean;
  models: SpeechModelOption[];
}

export interface SpeechModelOption {
  id: string;
  label: string;
  sizeMb: number;
  note: string;
}

export interface VoiceProgress {
  /** 0..100 across the files being downloaded, or null when unknown. */
  percent: number | null;
  status: 'downloading' | 'loading' | 'ready';
}

export interface TranscribeResult {
  ok: boolean;
  text?: string;
  error?: string;
}

/** Opt-in, session-scoped context access. Resets whenever the app restarts. */
export interface ContextGrant {
  windows: boolean;
  grantedAt: number | null;
}

export interface SystemMetrics {
  /** 0..100 */
  cpu: number;
  /** 0..100 */
  ram: number;
  /** 0..100, null when the drive could not be read */
  disk: number | null;
}
