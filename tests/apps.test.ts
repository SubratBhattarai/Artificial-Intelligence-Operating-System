import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { describe, expect, it } from 'vitest';
import { formatCents } from '../src/shared/apps';
import { parseCsv, parseMoneyToCents, toCsv } from '../src/shared/csv';
import { EventStore } from '../src/main/apps/eventStore';
import { FinanceStore } from '../src/main/apps/financeStore';
import { TaskStore } from '../src/main/apps/taskStore';

function tempDir(): string {
  return fs.mkdtempSync(path.join(os.tmpdir(), 'aios-apps-'));
}

describe('csv helpers', () => {
  it('parses quoted fields and round-trips', () => {
    const rows = parseCsv('a,b\n"x, y","say ""hi"""\n');
    expect(rows).toEqual([
      ['a', 'b'],
      ['x, y', 'say "hi"'],
    ]);
    expect(parseCsv(toCsv(rows))).toEqual(rows);
  });

  it('neutralises spreadsheet formulas on export', () => {
    expect(toCsv([['=SUM(A1)']]).startsWith("'=")).toBe(true);
  });

  it('reads money as integer cents', () => {
    expect(parseMoneyToCents('12.50')).toBe(1250);
    expect(parseMoneyToCents('-$1,234.05')).toBe(-123405);
    expect(parseMoneyToCents('(3.10)')).toBe(-310);
    expect(parseMoneyToCents('abc')).toBeNull();
    expect(formatCents(-1234)).toBe('-12.34');
  });
});

describe('TaskStore', () => {
  it('creates, completes, persists and removes tasks', () => {
    const dir = tempDir();
    const tasks = new TaskStore(dir);
    const task = tasks.create({ title: '  Pay rent ', due: '2026-12-01' }, 'jarvis');
    expect(task.title).toBe('Pay rent');
    expect(task.source).toBe('jarvis');
    expect(tasks.update(task.id, { status: 'done' }).completedAt).toBeGreaterThan(0);
    tasks.flush();
    expect(new TaskStore(dir).list()).toHaveLength(1);
    expect(tasks.remove(task.id)).toBe(true);
    expect(tasks.list()).toHaveLength(0);
  });

  it('rejects empty titles and bad dates', () => {
    const tasks = new TaskStore(tempDir());
    expect(() => tasks.create({ title: '   ' })).toThrow();
    expect(() => tasks.create({ title: 'x', due: '2026-02-31' })).toThrow();
  });
});

describe('EventStore', () => {
  it('lists by range, rejects reversed times and round-trips .ics', () => {
    const events = new EventStore(tempDir());
    const start = new Date('2026-03-05T14:00:00').getTime();
    events.create({ title: 'Dentist', start, end: start + 3_600_000, location: 'Main St' });
    expect(events.list({ from: start - 1000, to: start + 1000 })).toHaveLength(1);
    expect(events.list({ from: start + 7_200_000 })).toHaveLength(0);
    expect(() => events.create({ title: 'Bad', start, end: start - 1 })).toThrow();

    const ics = events.exportIcs();
    expect(ics).toContain('BEGIN:VEVENT');
    const copy = new EventStore(tempDir());
    const imported = copy.importIcs(ics);
    expect(imported.imported).toBe(1);
    expect(copy.list()[0].title).toBe('Dentist');
    // importing the same file again must not duplicate
    expect(copy.importIcs(ics).imported).toBe(0);
  });
});

describe('FinanceStore', () => {
  it('summarises a month and imports CSV without duplicating', () => {
    const finance = new FinanceStore(tempDir());
    finance.create({
      date: '2026-03-01',
      amountCents: 200000,
      description: 'Pay',
      category: 'Income',
    });
    finance.create({
      date: '2026-03-02',
      amountCents: -4550,
      description: 'Groceries',
      category: 'Food',
    });
    finance.create({ date: '2026-04-02', amountCents: -100, description: 'Other month' });
    const summary = finance.summary('2026-03');
    expect(summary.incomeCents).toBe(200000);
    expect(summary.expenseCents).toBe(4550);
    expect(summary.netCents).toBe(195450);
    expect(summary.byCategory[0].category).toBe('Food');

    const csv = 'Date,Description,Amount\n2026-03-05,Coffee,-3.50\nnot a date,Broken,1\n';
    const first = finance.importCsv(csv);
    expect(first.imported).toBe(1);
    expect(first.skipped).toBe(1);
    expect(finance.importCsv(csv).imported).toBe(0);
    expect(finance.exportCsv()).toContain('Coffee');
  });

  it('refuses bad input', () => {
    const finance = new FinanceStore(tempDir());
    expect(() => finance.create({ date: 'x', amountCents: 5, description: 'a' })).toThrow();
    expect(() =>
      finance.create({ date: '2026-01-01', amountCents: 1.5, description: 'a' }),
    ).toThrow();
    expect(finance.importCsv('nope').ok).toBe(false);
  });
});
