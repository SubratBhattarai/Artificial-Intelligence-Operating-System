import { randomUUID } from 'node:crypto';
import path from 'node:path';
import {
  formatCents,
  isDateString,
  type FinanceSummary,
  type ImportResult,
  type TransactionInput,
  type TransactionPatch,
  type TransactionRecord,
} from '../../shared/apps';
import { parseCsv, parseLooseDate, parseMoneyToCents, toCsv } from '../../shared/csv';
import { JsonFile } from '../store/jsonFile';

const MAX_TRANSACTIONS = 50_000;
const MAX_ABS_CENTS = 100_000_000_00;

interface FinanceData {
  version: 1;
  transactions: TransactionRecord[];
}

function cleanCents(value: unknown): number {
  if (typeof value !== 'number' || !Number.isInteger(value) || Math.abs(value) > MAX_ABS_CENTS) {
    throw new Error('The amount is not valid.');
  }
  if (value === 0) throw new Error('The amount cannot be zero.');
  return value;
}

function cleanText(value: unknown, max: number, fallback = ''): string {
  return typeof value === 'string' ? value.replace(/\s+/g, ' ').trim().slice(0, max) : fallback;
}

/**
 * Manual-entry ledger. There is no bank connection and nothing here moves money: it only records
 * what the user types or imports from a CSV they choose.
 */
export class FinanceStore {
  private readonly file: JsonFile<FinanceData>;

  constructor(dataDir: string) {
    this.file = new JsonFile<FinanceData>(
      path.join(dataDir, 'finance.json'),
      () => ({ version: 1, transactions: [] }),
      (raw) => {
        const data = raw as Partial<FinanceData> | null;
        if (!data || !Array.isArray(data.transactions)) return null;
        return {
          version: 1,
          transactions: data.transactions.filter(
            (entry): entry is TransactionRecord =>
              !!entry && typeof entry.id === 'string' && typeof entry.amountCents === 'number',
          ),
        };
      },
    );
  }

  private get transactions(): TransactionRecord[] {
    return this.file.value.transactions;
  }

  /** Newest first, optionally limited to one YYYY-MM month. */
  list(filter: { month?: string } = {}): TransactionRecord[] {
    return this.transactions
      .filter((entry) => !filter.month || entry.date.startsWith(filter.month))
      .sort((a, b) => b.date.localeCompare(a.date) || b.createdAt - a.createdAt)
      .map((entry) => ({ ...entry }));
  }

  create(input: TransactionInput, now = Date.now()): TransactionRecord {
    if (this.transactions.length >= MAX_TRANSACTIONS) {
      throw new Error(`Transactions are limited to ${MAX_TRANSACTIONS}.`);
    }
    if (!isDateString(input.date)) throw new Error('The date must look like 2026-12-31.');
    const description = cleanText(input.description, 200);
    if (!description) throw new Error('A transaction needs a description.');
    const entry: TransactionRecord = {
      id: randomUUID(),
      date: input.date,
      amountCents: cleanCents(input.amountCents),
      description,
      category: cleanText(input.category, 60, 'Uncategorized') || 'Uncategorized',
      account: cleanText(input.account, 60, 'Main') || 'Main',
      createdAt: now,
      updatedAt: now,
    };
    this.transactions.push(entry);
    this.file.touch();
    return { ...entry };
  }

  update(id: string, patch: TransactionPatch, now = Date.now()): TransactionRecord {
    const entry = this.transactions.find((item) => item.id === id);
    if (!entry) throw new Error('That transaction no longer exists.');
    if (patch.date !== undefined) {
      if (!isDateString(patch.date)) throw new Error('The date must look like 2026-12-31.');
      entry.date = patch.date;
    }
    if (patch.amountCents !== undefined) entry.amountCents = cleanCents(patch.amountCents);
    if (patch.description !== undefined) {
      const description = cleanText(patch.description, 200);
      if (!description) throw new Error('A transaction needs a description.');
      entry.description = description;
    }
    if (patch.category !== undefined) {
      entry.category = cleanText(patch.category, 60) || 'Uncategorized';
    }
    if (patch.account !== undefined) entry.account = cleanText(patch.account, 60) || 'Main';
    entry.updatedAt = now;
    this.file.touch();
    return { ...entry };
  }

  remove(id: string): boolean {
    const index = this.transactions.findIndex((item) => item.id === id);
    if (index < 0) return false;
    this.transactions.splice(index, 1);
    this.file.touch();
    return true;
  }

  summary(month: string): FinanceSummary {
    if (!/^\d{4}-\d{2}$/.test(month)) throw new Error('The month must look like 2026-12.');
    let income = 0;
    let expense = 0;
    let count = 0;
    const byCategory = new Map<string, number>();
    for (const entry of this.transactions) {
      if (!entry.date.startsWith(month)) continue;
      count += 1;
      if (entry.amountCents > 0) income += entry.amountCents;
      else {
        expense += -entry.amountCents;
        byCategory.set(entry.category, (byCategory.get(entry.category) ?? 0) - entry.amountCents);
      }
    }
    return {
      month,
      incomeCents: income,
      expenseCents: expense,
      netCents: income - expense,
      transactionCount: count,
      byCategory: [...byCategory.entries()]
        .map(([category, totalCents]) => ({ category, totalCents }))
        .sort((a, b) => b.totalCents - a.totalCents),
    };
  }

  /**
   * Import a CSV with a header row. Recognises date / description (or memo, payee) / amount
   * (or debit + credit) / category / account columns; rows that do not parse are skipped.
   */
  importCsv(text: string): ImportResult {
    const rows = parseCsv(text);
    if (rows.length < 2) {
      return { ok: false, imported: 0, skipped: 0, notes: [], error: 'The file has no data rows.' };
    }
    const header = rows[0].map((cell) => cell.trim().toLowerCase());
    const find = (...names: string[]) => header.findIndex((cell) => names.includes(cell));
    const dateCol = find('date', 'posted date', 'transaction date');
    const descCol = find('description', 'memo', 'payee', 'name', 'details');
    const amountCol = find('amount');
    const debitCol = find('debit', 'withdrawal', 'withdrawals');
    const creditCol = find('credit', 'deposit', 'deposits');
    const categoryCol = find('category');
    const accountCol = find('account');
    if (dateCol < 0 || descCol < 0 || (amountCol < 0 && debitCol < 0 && creditCol < 0)) {
      return {
        ok: false,
        imported: 0,
        skipped: 0,
        notes: [],
        error: 'The header needs date, description and amount (or debit/credit) columns.',
      };
    }
    let imported = 0;
    let skipped = 0;
    const existing = new Set(
      this.transactions.map((entry) => `${entry.date}|${entry.amountCents}|${entry.description}`),
    );
    for (const row of rows.slice(1)) {
      const date = parseLooseDate(row[dateCol] ?? '');
      let cents: number | null = null;
      if (amountCol >= 0) cents = parseMoneyToCents(row[amountCol] ?? '');
      else {
        const debit = debitCol >= 0 ? parseMoneyToCents(row[debitCol] ?? '') : null;
        const credit = creditCol >= 0 ? parseMoneyToCents(row[creditCol] ?? '') : null;
        cents = credit ? Math.abs(credit) : debit ? -Math.abs(debit) : null;
      }
      const description = cleanText(row[descCol], 200);
      if (!date || !cents || !description || this.transactions.length >= MAX_TRANSACTIONS) {
        skipped += 1;
        continue;
      }
      const key = `${date}|${cents}|${description}`;
      if (existing.has(key)) {
        skipped += 1;
        continue;
      }
      existing.add(key);
      this.create({
        date,
        amountCents: cents,
        description,
        category: categoryCol >= 0 ? row[categoryCol] : undefined,
        account: accountCol >= 0 ? row[accountCol] : undefined,
      });
      imported += 1;
    }
    return {
      ok: true,
      imported,
      skipped,
      notes: skipped > 0 ? ['Skipped rows were duplicates or could not be read.'] : [],
    };
  }

  exportCsv(): string {
    return toCsv([
      ['date', 'description', 'amount', 'category', 'account'],
      ...this.list()
        .reverse()
        .map((entry) => [
          entry.date,
          entry.description,
          formatCents(entry.amountCents),
          entry.category,
          entry.account,
        ]),
    ]);
  }

  flush(): void {
    this.file.flushSync();
  }
}
