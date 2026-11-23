import { randomUUID } from 'node:crypto';
import type { ApprovalInfo, RiskTier } from '../../shared/protocol';
import type { ToolPreview } from './types';

export type ApprovalDecision = 'approved' | 'denied' | 'expired' | 'cancelled';

export const APPROVAL_TIMEOUT_MS = 5 * 60_000;

interface PendingApproval {
  info: ApprovalInfo;
  resolve: (decision: ApprovalDecision) => void;
}

/**
 * Holds proposed actions until the user decides. Only a click in the app (IPC `tools:decide`)
 * can approve one, the exact previewed arguments are what later run, and an unanswered request
 * expires instead of waiting forever.
 */
export class ApprovalBroker {
  private readonly pending = new Map<string, PendingApproval>();

  constructor(private readonly timeoutMs = APPROVAL_TIMEOUT_MS) {}

  /** Resolve with the user's decision. `onRequest` shows the preview to the user. */
  request(
    tool: string,
    riskTier: RiskTier,
    preview: ToolPreview,
    onRequest: (info: ApprovalInfo) => void,
    signal?: AbortSignal,
  ): Promise<ApprovalDecision> {
    const info: ApprovalInfo = {
      id: randomUUID(),
      tool,
      riskTier,
      title: preview.title,
      lines: preview.lines,
      expiresAt: Date.now() + this.timeoutMs,
    };
    return new Promise<ApprovalDecision>((resolve) => {
      let settled = false;
      const settle = (decision: ApprovalDecision) => {
        if (settled) return;
        settled = true;
        clearTimeout(timer);
        signal?.removeEventListener('abort', onAbort);
        this.pending.delete(info.id);
        resolve(decision);
      };
      const timer = setTimeout(() => settle('expired'), this.timeoutMs);
      const onAbort = () => settle('cancelled');
      signal?.addEventListener('abort', onAbort, { once: true });
      this.pending.set(info.id, { info, resolve: settle });
      if (signal?.aborted) settle('cancelled');
      else onRequest(info);
    });
  }

  decide(id: string, approve: boolean): boolean {
    const entry = this.pending.get(id);
    if (!entry) return false;
    entry.resolve(approve ? 'approved' : 'denied');
    return true;
  }

  listPending(): ApprovalInfo[] {
    return [...this.pending.values()].map((entry) => entry.info);
  }
}
