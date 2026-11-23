import type { ToolCallInfo, ToolDescriptor } from '../../shared/protocol';
import {
  IdempotencyCache,
  executePlan,
  withBatchNote,
  type AuditSink,
  type ExecutedCall,
  type ExecutorDeps,
} from './executor';
import { planToolCalls, type PlannedCall } from './planner';
import {
  resolveTool,
  toToolSchema,
  type ResolvedTool,
  type Tool,
  type ToolExecutionContext,
} from './types';

export interface ToolRunResult {
  ok: boolean;
  /** JSON string handed back to the model as the tool message. */
  output: string;
}

export interface RegistryOptions {
  audit?: AuditSink;
  isEnabled?: (name: string) => boolean;
  /** Permission gate: null = allowed, text = why not. Enforced in the planner and again before running. */
  authorize?: (permissions: string[]) => string | null;
}

export class ToolRegistry {
  private readonly tools = new Map<string, ResolvedTool>();
  private readonly idempotency = new IdempotencyCache();

  constructor(private readonly options: RegistryOptions = {}) {}

  register(tool: Tool<any, any>): this {
    if (this.tools.has(tool.name)) {
      throw new Error(`Tool already registered: ${tool.name}`);
    }
    if (!/^[a-z][a-z0-9_]*$/.test(tool.name)) {
      throw new Error(`Invalid tool name: ${tool.name}`);
    }
    const resolved = resolveTool(tool);
    if (resolved.needsApproval && (!tool.preview || !tool.verify)) {
      throw new Error(`Tool ${tool.name} changes data, so it needs preview() and verify()`);
    }
    this.tools.set(tool.name, resolved);
    return this;
  }

  names(): string[] {
    return [...this.tools.keys()];
  }

  isEnabled = (name: string): boolean => this.options.isEnabled?.(name) ?? true;

  authorize = (permissions: string[]): string | null =>
    this.options.authorize?.(permissions) ?? null;

  resolve = (name: string): ResolvedTool | null => this.tools.get(name) ?? null;

  /** Schemas offered to the model: only tools the user has left enabled. */
  schemas() {
    return [...this.tools.values()]
      .filter((entry) => this.isEnabled(entry.tool.name))
      .map((entry) => toToolSchema(entry.tool));
  }

  descriptors(): ToolDescriptor[] {
    return [...this.tools.values()].map((entry) => ({
      name: entry.tool.name,
      description: entry.tool.description,
      parameters: entry.tool.parameters,
      riskTier: entry.riskTier,
      permissions: entry.permissions,
      timeoutMs: entry.timeoutMs,
      needsApproval: entry.needsApproval,
      enabled: this.isEnabled(entry.tool.name),
    }));
  }

  plan(calls: ToolCallInfo[]): PlannedCall[] {
    return planToolCalls(calls, this);
  }

  /** Plan, approve, execute and verify a batch of model-proposed calls. */
  async runBatch(
    calls: ToolCallInfo[],
    deps: Omit<ExecutorDeps, 'audit' | 'authorize' | 'idempotency'>,
  ): Promise<ExecutedCall[]> {
    const planned = this.plan(calls);
    return withBatchNote(
      await executePlan(planned, {
        ...deps,
        audit: this.options.audit,
        authorize: this.authorize,
        idempotency: this.idempotency,
      }),
    );
  }

  /**
   * Execute one call through the same pipeline. Never throws: failures become `{ok:false}`
   * payloads so the model can explain them. Changing tools are denied unless a broker is given.
   */
  async run(
    name: string,
    rawArgs: unknown,
    ctx: ToolExecutionContext = {},
    deps: Omit<ExecutorDeps, 'audit' | 'signal' | 'sessionId' | 'authorize' | 'idempotency'> = {},
  ): Promise<ToolRunResult> {
    const call: ToolCallInfo = {
      id: 'direct',
      name,
      arguments: typeof rawArgs === 'string' ? rawArgs : JSON.stringify(rawArgs ?? {}),
    };
    const [outcome] = await this.runBatch([call], {
      ...deps,
      signal: ctx.signal,
      sessionId: ctx.sessionId,
    });
    return { ok: outcome.ok, output: outcome.output };
  }
}
