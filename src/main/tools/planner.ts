import type { RiskTier, ToolCallInfo } from '../../shared/protocol';
import { validateArgs } from './schemaValidate';
import type { ResolvedTool, ToolPreview } from './types';

/** Largest number of changing actions the model may propose in one turn. */
export const MAX_CHANGES_PER_TURN = 3;
const MAX_CALLS_PER_TURN = 6;

export interface PlanLookup {
  resolve(name: string): ResolvedTool | null;
  isEnabled(name: string): boolean;
  /** Null when the user's permissions allow the call; otherwise the reason it is refused. */
  authorize?(permissions: string[]): string | null;
}

export type PlannedCall =
  | {
      status: 'ready';
      call: ToolCallInfo;
      resolved: ResolvedTool;
      args: Record<string, unknown>;
      preview?: ToolPreview;
    }
  | {
      status: 'rejected';
      call: ToolCallInfo;
      resolved: ResolvedTool | null;
      reason: string;
    };

function parseArguments(raw: unknown): Record<string, unknown> | null {
  let value = raw;
  if (value == null || value === '') return {};
  if (typeof value === 'string') {
    try {
      value = JSON.parse(value);
    } catch {
      return null;
    }
  }
  if (typeof value !== 'object' || value === null || Array.isArray(value)) return null;
  return value as Record<string, unknown>;
}

/**
 * Planning is separate from execution: the model's proposed calls are checked here, in plain
 * deterministic code, before anything runs. A call is accepted only if the tool exists and is
 * enabled, its arguments satisfy the tool's schema, and the turn stays within its action budget.
 * Accepted calls carry a preview so changing actions can be shown to the user first.
 */
export function planToolCalls(calls: ToolCallInfo[], lookup: PlanLookup): PlannedCall[] {
  let changes = 0;
  const seenChanges = new Set<string>();
  return calls.map((call, index): PlannedCall => {
    const resolved = lookup.resolve(call.name);
    if (index >= MAX_CALLS_PER_TURN) {
      return { status: 'rejected', call, resolved, reason: 'too_many_calls_in_one_turn' };
    }
    if (!resolved)
      return { status: 'rejected', call, resolved: null, reason: `unknown_tool: ${call.name}` };
    if (!lookup.isEnabled(call.name)) {
      return { status: 'rejected', call, resolved, reason: 'tool_disabled_by_user' };
    }
    const denied = lookup.authorize?.(resolved.permissions) ?? null;
    if (denied) return { status: 'rejected', call, resolved, reason: denied };
    const args = parseArguments(call.arguments);
    if (args === null) {
      return { status: 'rejected', call, resolved, reason: `invalid_arguments_for: ${call.name}` };
    }
    const validation = validateArgs(resolved.tool.parameters, args);
    if (!validation.ok) {
      return {
        status: 'rejected',
        call,
        resolved,
        reason: `invalid_arguments_for: ${call.name}: ${validation.errors.join('; ')}`,
      };
    }
    if (resolved.needsApproval) {
      if (
        typeof resolved.tool.preview !== 'function' ||
        typeof resolved.tool.verify !== 'function'
      ) {
        return {
          status: 'rejected',
          call,
          resolved,
          reason: 'tool_missing_preview_or_verification',
        };
      }
      const signature = `${call.name}:${JSON.stringify(validation.value)}`;
      if (seenChanges.has(signature)) {
        return { status: 'rejected', call, resolved, reason: 'duplicate_change_in_one_turn' };
      }
      changes += 1;
      if (changes > MAX_CHANGES_PER_TURN) {
        return { status: 'rejected', call, resolved, reason: 'too_many_changes_in_one_turn' };
      }
      seenChanges.add(signature);
      let preview: ToolPreview;
      try {
        preview = resolved.tool.preview(validation.value);
      } catch (error) {
        return {
          status: 'rejected',
          call,
          resolved,
          reason: `preview_failed: ${error instanceof Error ? error.message : String(error)}`,
        };
      }
      return { status: 'ready', call, resolved, args: validation.value, preview };
    }
    return { status: 'ready', call, resolved, args: validation.value };
  });
}

export function riskLabel(tier: RiskTier): string {
  return tier === 'read' ? 'Read-only' : tier === 'low' ? 'Reversible change' : 'High impact';
}
