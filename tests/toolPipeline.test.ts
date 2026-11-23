import { describe, expect, it } from 'vitest';
import type { ApprovalInfo, ToolCallInfo } from '../src/shared/protocol';
import { ApprovalBroker } from '../src/main/tools/approvals';
import { AuditStore } from '../src/main/tools/audit';
import { validateArgs } from '../src/main/tools/schemaValidate';
import { ToolRegistry } from '../src/main/tools/registry';
import type { Tool } from '../src/main/tools/types';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

interface Store {
  items: string[];
}

function makeAddTool(
  store: Store,
  options: { verifyOk?: boolean; delayMs?: number; withRollback?: boolean } = {},
): Tool<{ text: string }, { text: string }> {
  const { verifyOk = true, delayMs = 0, withRollback = true } = options;
  return {
    name: 'add_item',
    description: 'Adds an item (test fixture).',
    riskTier: 'low',
    permissions: ['tasks:write'],
    timeoutMs: 80,
    parameters: {
      type: 'object',
      properties: { text: { type: 'string', minLength: 1, maxLength: 20 } },
      required: ['text'],
      additionalProperties: false,
    },
    preview: (params) => ({ title: 'Add item', lines: [params.text] }),
    async execute(params) {
      if (delayMs) await new Promise((resolve) => setTimeout(resolve, delayMs));
      store.items.push(params.text);
      return { text: params.text };
    },
    verify: (_params, result) =>
      verifyOk && store.items.includes(result.text)
        ? { ok: true, detail: 'found' }
        : { ok: false, detail: 'missing on read-back' },
    rollback: withRollback
      ? (_params, result) => {
          store.items = store.items.filter((item) => item !== result?.text);
        }
      : undefined,
  };
}

function call(name: string, args: unknown, id = name): ToolCallInfo {
  return { id, name, arguments: typeof args === 'string' ? args : JSON.stringify(args) };
}

/** Approve (or deny) automatically as soon as the preview is shown. */
function autoDecide(broker: ApprovalBroker, approve: boolean) {
  const seen: ApprovalInfo[] = [];
  return {
    seen,
    onApproval: (info: ApprovalInfo) => {
      seen.push(info);
      queueMicrotask(() => broker.decide(info.id, approve));
    },
  };
}

describe('validateArgs', () => {
  const schema = {
    type: 'object' as const,
    properties: {
      title: { type: 'string', minLength: 1, maxLength: 5 },
      n: { type: 'integer', minimum: 1, maximum: 3 },
      day: { type: 'string', format: 'date' },
      kind: { type: 'string', enum: ['a', 'b'] },
    },
    required: ['title'],
    additionalProperties: false,
  };

  it('accepts valid input', () => {
    expect(validateArgs(schema, { title: 'hi', n: 2, day: '2026-02-03', kind: 'a' }).ok).toBe(true);
  });

  it('reports every kind of violation', () => {
    const result = validateArgs(schema, {
      title: '',
      n: 9,
      day: '2026-02-31',
      kind: 'z',
      extra: 1,
    });
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.errors.length).toBeGreaterThanOrEqual(5);
    expect(validateArgs(schema, {}).ok).toBe(false);
  });
});

describe('tool pipeline', () => {
  it('runs a change only after approval, then verifies it', async () => {
    const store: Store = { items: [] };
    const broker = new ApprovalBroker(1000);
    const registry = new ToolRegistry().register(makeAddTool(store));
    const decider = autoDecide(broker, true);
    const [result] = await registry.runBatch([call('add_item', { text: 'milk' })], {
      broker,
      onApproval: decider.onApproval,
    });
    expect(result.status).toBe('verified');
    expect(result.ok).toBe(true);
    expect(store.items).toEqual(['milk']);
    expect(decider.seen[0].lines).toEqual(['milk']);
  });

  it('does not execute when the user denies', async () => {
    const store: Store = { items: [] };
    const broker = new ApprovalBroker(1000);
    const registry = new ToolRegistry().register(makeAddTool(store));
    const decider = autoDecide(broker, false);
    const [result] = await registry.runBatch([call('add_item', { text: 'milk' })], {
      broker,
      onApproval: decider.onApproval,
    });
    expect(result.status).toBe('denied');
    expect(result.ok).toBe(false);
    expect(store.items).toEqual([]);
  });

  it('expires an unanswered approval without executing', async () => {
    const store: Store = { items: [] };
    const broker = new ApprovalBroker(30);
    const registry = new ToolRegistry().register(makeAddTool(store));
    const [result] = await registry.runBatch([call('add_item', { text: 'milk' })], {
      broker,
      onApproval: () => undefined,
    });
    expect(result.status).toBe('denied');
    expect(result.detail).toBe('approval_expired');
    expect(store.items).toEqual([]);
  });

  it('denies every change when nobody can approve (legacy run)', async () => {
    const store: Store = { items: [] };
    const registry = new ToolRegistry().register(makeAddTool(store));
    const result = await registry.run('add_item', { text: 'milk' });
    expect(result.ok).toBe(false);
    expect(store.items).toEqual([]);
  });

  it('rolls back and reports failure when verification fails', async () => {
    const store: Store = { items: [] };
    const broker = new ApprovalBroker(1000);
    const registry = new ToolRegistry().register(makeAddTool(store, { verifyOk: false }));
    const decider = autoDecide(broker, true);
    const [result] = await registry.runBatch([call('add_item', { text: 'milk' })], {
      broker,
      onApproval: decider.onApproval,
    });
    expect(result.status).toBe('rolled_back');
    expect(result.ok).toBe(false);
    expect(store.items).toEqual([]);
  });

  it('reports not_verified (never success) when it cannot roll back', async () => {
    const store: Store = { items: [] };
    const broker = new ApprovalBroker(1000);
    const registry = new ToolRegistry().register(
      makeAddTool(store, { verifyOk: false, withRollback: false }),
    );
    const decider = autoDecide(broker, true);
    const [result] = await registry.runBatch([call('add_item', { text: 'milk' })], {
      broker,
      onApproval: decider.onApproval,
    });
    expect(result.status).toBe('not_verified');
    expect(result.ok).toBe(false);
  });

  it('times out a slow change and undoes it', async () => {
    const store: Store = { items: [] };
    const broker = new ApprovalBroker(1000);
    const registry = new ToolRegistry().register(makeAddTool(store, { delayMs: 300 }));
    const decider = autoDecide(broker, true);
    const [result] = await registry.runBatch([call('add_item', { text: 'milk' })], {
      broker,
      onApproval: decider.onApproval,
    });
    expect(result.ok).toBe(false);
    expect(['rolled_back', 'failed']).toContain(result.status);
    await new Promise((resolve) => setTimeout(resolve, 350));
    // The slow execute() may still finish later, but nothing may be reported as success.
    expect(result.output).toContain('timed_out');
  });

  it('rejects schema violations before anything runs', async () => {
    const store: Store = { items: [] };
    const broker = new ApprovalBroker(1000);
    const registry = new ToolRegistry().register(makeAddTool(store));
    const results = await registry.runBatch(
      [call('add_item', { text: '' }, 'a'), call('add_item', { text: 'x', extra: true }, 'b')],
      { broker, onApproval: () => undefined },
    );
    expect(results.map((entry) => entry.status)).toEqual(['rejected', 'rejected']);
    expect(store.items).toEqual([]);
  });

  it('limits changes per turn, blocks duplicates and summarises partial batches', async () => {
    const store: Store = { items: [] };
    const broker = new ApprovalBroker(1000);
    const registry = new ToolRegistry().register(makeAddTool(store));
    const decider = autoDecide(broker, true);
    const results = await registry.runBatch(
      [
        call('add_item', { text: 'a' }, '1'),
        call('add_item', { text: 'a' }, '2'),
        call('add_item', { text: 'b' }, '3'),
        call('add_item', { text: 'c' }, '4'),
        call('add_item', { text: 'd' }, '5'),
      ],
      { broker, onApproval: decider.onApproval },
    );
    expect(results.map((entry) => entry.status)).toEqual([
      'verified',
      'rejected',
      'verified',
      'verified',
      'rejected',
    ]);
    expect(store.items).toEqual(['a', 'b', 'c']);
    expect(JSON.parse(results[0].output).batch.note).toContain('PARTIAL: 3 of 5');
  });

  it('refuses disabled tools', async () => {
    const store: Store = { items: [] };
    const registry = new ToolRegistry({ isEnabled: () => false }).register(makeAddTool(store));
    expect(registry.schemas()).toHaveLength(0);
    const [result] = await registry.runBatch([call('add_item', { text: 'x' })], {});
    expect(result.status).toBe('rejected');
    expect(result.detail).toContain('disabled');
  });

  it('refuses to register a changing tool without preview and verify', () => {
    const bad: Tool = {
      name: 'bad_writer',
      description: 'x',
      riskTier: 'low',
      parameters: { type: 'object', properties: {} },
      async execute() {
        return 1;
      },
    };
    expect(() => new ToolRegistry().register(bad)).toThrow(/preview/);
  });

  it('records every call in the audit log', async () => {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-audit-'));
    const audit = new AuditStore(dir);
    const store: Store = { items: [] };
    const broker = new ApprovalBroker(1000);
    const registry = new ToolRegistry({ audit }).register(makeAddTool(store));
    const decider = autoDecide(broker, true);
    await registry.runBatch([call('add_item', { text: 'milk' }), call('nope', {}, 'x')], {
      broker,
      onApproval: decider.onApproval,
    });
    const records = audit.list();
    expect(records).toHaveLength(2);
    const outcomes = records.map((record) => record.outcome).sort();
    expect(outcomes).toEqual(['rejected', 'verified']);
    const verified = records.find((record) => record.outcome === 'verified');
    expect(verified?.approval).toBe('approved');
    expect(verified?.stages.map((stage) => stage.stage)).toContain('verifying');
    expect(audit.clear()).toBe(2);
    audit.flush();
  });
});
