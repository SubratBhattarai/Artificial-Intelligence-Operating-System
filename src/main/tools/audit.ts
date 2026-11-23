import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type { ActionState, AuditOutcome, AuditRecord, RiskTier } from '../../shared/protocol';
import { JsonFile } from '../store/jsonFile';

const MAX_RECORDS = 1000;
const MAX_ARGS_LENGTH = 600;
const MAX_DETAIL_LENGTH = 400;

interface AuditData {
  version: 1;
  records: AuditRecord[];
}

/** Map a final outcome onto the six-step action lifecycle. */
export function stateForOutcome(outcome: AuditOutcome): ActionState {
  switch (outcome) {
    case 'completed':
    case 'verified':
      return 'succeeded';
    case 'denied':
    case 'cancelled':
    case 'expired':
      return 'cancelled';
    default:
      return 'failed';
  }
}

const SECRET_PATTERNS: Array<[RegExp, string]> = [
  [/\b(sk|pk|rk|ghp|gho|xox[abp])[-_][A-Za-z0-9_-]{16,}/g, '[redacted key]'],
  [/\bBearer\s+[A-Za-z0-9._~+/=-]{12,}/gi, 'Bearer [redacted]'],
  [/\b[A-Fa-f0-9]{40,}\b/g, '[redacted hex]'],
  [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[redacted token]'],
  [
    /("?(?:password|passwd|secret|token|api[_-]?key|authorization)"?\s*[:=]\s*)("[^"]*"|'[^']*'|[^\s,}]+)/gi,
    '$1"[redacted]"',
  ],
];

/** Strip anything that looks like a credential before text is stored or logged. */
export function redactSecrets(text: string): string {
  return SECRET_PATTERNS.reduce(
    (acc, [pattern, replacement]) => acc.replace(pattern, replacement),
    text,
  );
}

export interface AuditHandle {
  stage(stage: string, note?: string): void;
  setApproval(approval: AuditRecord['approval']): void;
  finish(outcome: AuditOutcome, detail: string): AuditRecord;
}

/** Every tool call — allowed, refused or failed — leaves a record the user can read and clear. */
export class AuditStore {
  private readonly file: JsonFile<AuditData>;

  constructor(dataDir: string) {
    this.file = new JsonFile<AuditData>(
      path.join(dataDir, 'audit.json'),
      () => ({ version: 1, records: [] }),
      (raw) => {
        const data = raw as Partial<AuditData> | null;
        if (!data || !Array.isArray(data.records)) return null;
        return {
          version: 1,
          records: data.records.filter(
            (record): record is AuditRecord => !!record && typeof record.id === 'string',
          ),
        };
      },
    );
  }

  begin(info: {
    tool: string;
    riskTier: RiskTier;
    permissions: string[];
    args: unknown;
    sessionId?: string;
    approval?: AuditRecord['approval'];
    idempotencyKey?: string;
  }): AuditHandle {
    const startedAt = Date.now();
    let argsText: string;
    try {
      argsText = typeof info.args === 'string' ? info.args : JSON.stringify(info.args ?? {});
    } catch {
      argsText = '[unserialisable]';
    }
    const record: AuditRecord = {
      id: randomUUID(),
      at: startedAt,
      sessionId: info.sessionId,
      tool: info.tool,
      riskTier: info.riskTier,
      permissions: info.permissions,
      args: redactSecrets(argsText).slice(0, MAX_ARGS_LENGTH),
      idempotencyKey: info.idempotencyKey,
      approval: info.approval ?? 'not_required',
      outcome: 'failed',
      detail: '',
      durationMs: 0,
      stages: [{ stage: 'proposed', at: startedAt }],
    };
    return {
      stage: (stage, note) => {
        record.stages.push({ stage, at: Date.now(), note: note?.slice(0, 200) });
      },
      setApproval: (approval) => {
        record.approval = approval;
      },
      finish: (outcome, detail) => {
        record.outcome = outcome;
        record.detail = redactSecrets(detail).slice(0, MAX_DETAIL_LENGTH);
        record.state = stateForOutcome(outcome);
        record.durationMs = Date.now() - startedAt;
        record.stages.push({ stage: outcome, at: Date.now() });
        const records = this.file.value.records;
        records.push(record);
        if (records.length > MAX_RECORDS) records.splice(0, records.length - MAX_RECORDS);
        this.file.touch();
        return { ...record };
      },
    };
  }

  list(limit = 200): AuditRecord[] {
    return this.file.value.records
      .slice(-limit)
      .reverse()
      .map((record) => ({ ...record, stages: record.stages.map((stage) => ({ ...stage })) }));
  }

  countOlderThan(cutoff: number): number {
    return this.file.value.records.filter((record) => record.at < cutoff).length;
  }

  pruneOlderThan(cutoff: number): number {
    const before = this.file.value.records.length;
    this.file.value.records = this.file.value.records.filter((record) => record.at >= cutoff);
    const removed = before - this.file.value.records.length;
    if (removed > 0) this.file.touch();
    return removed;
  }

  clear(): number {
    const removed = this.file.value.records.length;
    this.file.value.records = [];
    this.file.touch();
    return removed;
  }

  flush(): void {
    this.file.flushSync();
  }
}
