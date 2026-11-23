import { randomUUID } from 'node:crypto';
import path from 'node:path';
import type {
  MemoryInput,
  MemoryPatch,
  MemoryRecord,
  MemorySettings,
  MemorySource,
  MemorySourceSummary,
  MemoryStatus,
} from '../../shared/protocol';
import { JsonFile } from '../store/jsonFile';

const MAX_RECORDS = 1000;
const MAX_FACT_LENGTH = 500;
const MAX_PROMPT_FACTS = 25;

interface MemoryData {
  version: 1;
  settings: MemorySettings;
  memories: MemoryRecord[];
}

export function sourceKey(source: MemorySource): string {
  return `${source.kind}:${source.sessionId ?? source.label}`;
}

function clampConfidence(value: unknown, fallback: number): number {
  if (typeof value !== 'number' || Number.isNaN(value)) return fallback;
  return Math.min(1, Math.max(0, value));
}

function normaliseFact(value: unknown): string {
  if (typeof value !== 'string') throw new Error('A memory needs text.');
  const fact = value.replace(/\s+/g, ' ').trim();
  if (fact.length === 0) throw new Error('A memory cannot be empty.');
  if (fact.length > MAX_FACT_LENGTH) {
    throw new Error(`A memory is limited to ${MAX_FACT_LENGTH} characters.`);
  }
  return fact;
}

function normaliseExpiry(value: unknown, now: number): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== 'number' || !Number.isFinite(value)) throw new Error('Invalid expiry date.');
  if (value <= now) throw new Error('The expiry date must be in the future.');
  return value;
}

export interface AddMemoryOptions {
  source?: MemorySource;
  status?: MemoryStatus;
  now?: number;
}

/**
 * Explicit, user-controlled memory. Every record carries its fact, where it came from, when it
 * was created, how confident we are and when it expires. Records suggested by the model start
 * `pending` and are ignored until the user approves them.
 */
export class MemoryStore {
  private readonly file: JsonFile<MemoryData>;

  constructor(dataDir: string) {
    this.file = new JsonFile<MemoryData>(
      path.join(dataDir, 'memory.json'),
      () => ({ version: 1, settings: { injectIntoPrompt: true }, memories: [] }),
      (raw) => {
        const data = raw as Partial<MemoryData> | null;
        if (!data || !Array.isArray(data.memories)) return null;
        return {
          version: 1,
          settings: { injectIntoPrompt: data.settings?.injectIntoPrompt !== false },
          memories: data.memories.filter(
            (record): record is MemoryRecord =>
              !!record && typeof record.id === 'string' && typeof record.fact === 'string',
          ),
        };
      },
    );
  }

  private get records(): MemoryRecord[] {
    return this.file.value.memories;
  }

  getSettings(): MemorySettings {
    return { ...this.file.value.settings };
  }

  setSettings(patch: Partial<MemorySettings>): MemorySettings {
    if (typeof patch.injectIntoPrompt === 'boolean') {
      this.file.value.settings.injectIntoPrompt = patch.injectIntoPrompt;
      this.file.touch();
    }
    return this.getSettings();
  }

  isExpired(record: MemoryRecord, now = Date.now()): boolean {
    return record.expiresAt !== null && record.expiresAt <= now;
  }

  /** Newest first. Expired records are hidden unless asked for. */
  list(
    options: { includeExpired?: boolean; status?: MemoryStatus; now?: number } = {},
  ): MemoryRecord[] {
    const now = options.now ?? Date.now();
    return this.records
      .filter((record) => (options.includeExpired ? true : !this.isExpired(record, now)))
      .filter((record) => (options.status ? record.status === options.status : true))
      .sort((a, b) => b.createdAt - a.createdAt)
      .map((record) => ({ ...record, source: { ...record.source } }));
  }

  get(id: string): MemoryRecord | null {
    return this.records.find((record) => record.id === id) ?? null;
  }

  add(input: MemoryInput, options: AddMemoryOptions = {}): MemoryRecord {
    const now = options.now ?? Date.now();
    const fact = normaliseFact(input.fact);
    const status = options.status ?? 'active';
    const source: MemorySource = options.source ?? { kind: 'manual', label: 'Added by you' };

    const existing = this.records.find(
      (record) => record.fact.toLowerCase() === fact.toLowerCase() && !this.isExpired(record, now),
    );
    if (existing) {
      // Never silently downgrade or duplicate: an approved fact stays approved.
      return existing;
    }
    if (this.records.length >= MAX_RECORDS) {
      throw new Error(`Memory is full (${MAX_RECORDS} records). Delete some before adding more.`);
    }

    const record: MemoryRecord = {
      id: randomUUID(),
      fact,
      source,
      createdAt: now,
      updatedAt: now,
      confidence: clampConfidence(input.confidence, status === 'pending' ? 0.6 : 1),
      expiresAt: normaliseExpiry(input.expiresAt, now),
      status,
    };
    this.records.push(record);
    this.file.touch();
    return record;
  }

  update(id: string, patch: MemoryPatch, now = Date.now()): MemoryRecord {
    const record = this.get(id);
    if (!record) throw new Error('That memory no longer exists.');
    if (patch.fact !== undefined) record.fact = normaliseFact(patch.fact);
    if (patch.confidence !== undefined) {
      record.confidence = clampConfidence(patch.confidence, record.confidence);
    }
    if (patch.expiresAt !== undefined) record.expiresAt = normaliseExpiry(patch.expiresAt, now);
    record.updatedAt = now;
    this.file.touch();
    return { ...record };
  }

  /** Approve a pending suggestion; it becomes active and attributed to the user's approval. */
  approve(id: string, now = Date.now()): MemoryRecord {
    const record = this.get(id);
    if (!record) throw new Error('That suggestion no longer exists.');
    record.status = 'active';
    record.updatedAt = now;
    this.file.touch();
    return { ...record };
  }

  remove(id: string): boolean {
    const index = this.records.findIndex((record) => record.id === id);
    if (index < 0) return false;
    this.records.splice(index, 1);
    this.file.touch();
    return true;
  }

  /** Delete every record that came from one source. Returns how many were removed. */
  removeBySource(key: string): number {
    const before = this.records.length;
    this.file.value.memories = this.records.filter((record) => sourceKey(record.source) !== key);
    const removed = before - this.records.length;
    if (removed > 0) this.file.touch();
    return removed;
  }

  /** Delete every record created from a conversation (used when that conversation is deleted). */
  removeBySession(sessionId: string): number {
    const before = this.records.length;
    this.file.value.memories = this.records.filter(
      (record) => record.source.sessionId !== sessionId,
    );
    const removed = before - this.records.length;
    if (removed > 0) this.file.touch();
    return removed;
  }

  clearAll(): number {
    const removed = this.records.length;
    this.file.value.memories = [];
    this.file.touch();
    return removed;
  }

  countExpired(now = Date.now()): number {
    return this.records.filter((record) => this.isExpired(record, now)).length;
  }

  purgeExpired(now = Date.now()): number {
    const before = this.records.length;
    this.file.value.memories = this.records.filter((record) => !this.isExpired(record, now));
    const removed = before - this.records.length;
    if (removed > 0) this.file.touch();
    return removed;
  }

  sources(now = Date.now()): MemorySourceSummary[] {
    const groups = new Map<string, MemorySourceSummary>();
    for (const record of this.records) {
      if (this.isExpired(record, now)) continue;
      const key = sourceKey(record.source);
      const group = groups.get(key);
      if (group) group.count += 1;
      else {
        groups.set(key, {
          key,
          kind: record.source.kind,
          label: record.source.label,
          sessionId: record.source.sessionId,
          count: 1,
        });
      }
    }
    return [...groups.values()].sort((a, b) => b.count - a.count);
  }

  /** Active, unexpired facts as a compact list for the model's context. */
  promptFacts(now = Date.now()): string[] {
    return this.list({ status: 'active', now })
      .slice(0, MAX_PROMPT_FACTS)
      .map((record) => record.fact);
  }

  flush(): void {
    this.file.flushSync();
  }
}
