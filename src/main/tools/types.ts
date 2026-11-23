import type { RiskTier } from '../../shared/protocol';

/**
 * Typed tool contract. A tool is a declaration (schema, permissions, risk tier, timeout) plus
 * deterministic hooks. The model only *proposes* calls; planning, approval, execution and
 * verification all happen in code (see planner.ts and executor.ts).
 */
export interface JsonSchemaObject {
  type: 'object';
  properties: Record<string, unknown>;
  required?: string[];
  additionalProperties?: boolean;
}

export interface ToolSchema {
  type: 'function';
  function: {
    name: string;
    description: string;
    parameters: JsonSchemaObject;
  };
}

export interface ToolExecutionContext {
  signal?: AbortSignal;
  /** Conversation session the tool call belongs to, when known. */
  sessionId?: string;
}

export type ToolPermission =
  | 'status:read'
  | 'files:read'
  | 'memory:read'
  | 'memory:suggest'
  | 'tasks:read'
  | 'tasks:write'
  | 'calendar:read'
  | 'calendar:write'
  | 'notes:write'
  | 'system:read'
  | 'mail:read'
  | 'calculator:use'
  | 'web:open'
  | 'web:read'
  | 'files:write'
  | 'screen:capture'
  | 'apps:control'
  | 'terminal:run'
  | 'devices:control'
  | 'agents:run'
  | 'activity:read'
  | 'clipboard:read'
  | 'camera:capture';

/** Deterministic, side-effect-free description of what a call would do. */
export interface ToolPreview {
  title: string;
  lines: string[];
}

export interface ToolVerification {
  ok: boolean;
  detail: string;
}

export interface Tool<P = Record<string, unknown>, R = unknown> {
  name: string;
  description: string;
  parameters: JsonSchemaObject;
  /** What the tool is allowed to touch. Defaults to none. */
  permissions?: ToolPermission[];
  /** Result contains text from files, mail or other outside sources: the model must treat it as data. */
  untrusted?: boolean;
  /** Argument names whose values are replaced by a length marker in the audit log. */
  sensitiveArgs?: string[];
  /** Defaults to 'read'. Anything above 'read' needs the user's approval for every call. */
  riskTier?: RiskTier;
  /** Hard time limit for execute(). Defaults to 15 s (read) or 10 s (changes). */
  timeoutMs?: number;
  /** Required for any tool above 'read': shown to the user before they approve. */
  preview?(params: P): ToolPreview;
  /** May throw; the executor converts failures into a tool error payload. */
  execute(params: P, ctx: ToolExecutionContext): Promise<R>;
  /**
   * Required for changing tools: read the real state back and confirm the change happened.
   * "Executed" is never reported as success until this returns ok.
   */
  verify?(params: P, result: R): Promise<ToolVerification> | ToolVerification;
  /** Undo a change that executed but could not be verified. */
  rollback?(params: P, result: R): Promise<void> | void;
}

export interface ResolvedTool {
  tool: Tool<any, any>;
  riskTier: RiskTier;
  permissions: ToolPermission[];
  timeoutMs: number;
  needsApproval: boolean;
}

export const DEFAULT_READ_TIMEOUT_MS = 15_000;
export const DEFAULT_WRITE_TIMEOUT_MS = 10_000;

export function resolveTool(tool: Tool<any, any>): ResolvedTool {
  const riskTier = tool.riskTier ?? 'read';
  return {
    tool,
    riskTier,
    permissions: tool.permissions ?? [],
    timeoutMs:
      tool.timeoutMs ?? (riskTier === 'read' ? DEFAULT_READ_TIMEOUT_MS : DEFAULT_WRITE_TIMEOUT_MS),
    needsApproval: riskTier !== 'read',
  };
}

export function toToolSchema(tool: Tool<any, any>): ToolSchema {
  return {
    type: 'function',
    function: {
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters,
    },
  };
}
