import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { formatCents, type FinanceSummary, type TransactionRecord } from '../../shared/apps';
import { parseMoneyToCents } from '../../shared/csv';
import { ConfirmButton } from '../components/ConfirmButton';
import { AppTabs, Banners, describeExport, describeImport, todayString, useRunner } from './appKit';
import type { ShellAppProps } from './types';

function monthOf(date: string): string {
  return date.slice(0, 7);
}

function shiftMonth(month: string, delta: number): string {
  const [year, m] = month.split('-').map(Number);
  const date = new Date(year, m - 1 + delta, 1);
  return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, '0')}`;
}

export function FinanceApp(_props: ShellAppProps): ReactElement {
  const api = window.aios;
  const [month, setMonth] = useState(monthOf(todayString()));
  const [transactions, setTransactions] = useState<TransactionRecord[]>([]);
  const [summary, setSummary] = useState<FinanceSummary | null>(null);
  const [date, setDate] = useState(todayString());
  const [kind, setKind] = useState<'expense' | 'income'>('expense');
  const [amount, setAmount] = useState('');
  const [description, setDescription] = useState('');
  const [category, setCategory] = useState('');
  const [account, setAccount] = useState('');

  const reload = useCallback(async () => {
    if (!api) return;
    const [list, nextSummary] = await Promise.all([
      api.finance.list(month),
      api.finance.summary(month),
    ]);
    setTransactions(list);
    setSummary(nextSummary);
  }, [api, month]);
  const { error, notice, setNotice, setError, run } = useRunner(reload);

  useEffect(() => {
    reload().catch((err) => setError(err instanceof Error ? err.message : String(err)));
  }, [reload, setError]);

  if (!api) return <div className="app-pad banner error">Backend bridge unavailable.</div>;

  const add = () => {
    const cents = parseMoneyToCents(amount);
    if (cents === null || cents === 0) {
      setError('Enter an amount such as 12.50.');
      return;
    }
    if (!description.trim()) return;
    void run(async () => {
      const magnitude = Math.abs(cents);
      await api.finance.create({
        date,
        amountCents: kind === 'expense' ? -magnitude : magnitude,
        description,
        category,
        account,
      });
      setAmount('');
      setDescription('');
    });
  };

  const largest = summary?.byCategory[0]?.totalCents ?? 0;

  return (
    <div className="mem">
      <AppTabs
        tabs={[['m', 'Money in & out']]}
        value="m"
        onChange={() => undefined}
        trailing={
          <>
            <button
              type="button"
              className="btn"
              onClick={() => setMonth(shiftMonth(month, -1))}
              aria-label="Previous month"
            >
              ‹
            </button>
            <span className="fin-month">{month}</span>
            <button
              type="button"
              className="btn"
              onClick={() => setMonth(shiftMonth(month, 1))}
              aria-label="Next month"
            >
              ›
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void run(async () => {
                  setNotice(describeImport(await api.finance.importCsv()) || null);
                })
              }
            >
              Import CSV
            </button>
            <button
              type="button"
              className="btn"
              onClick={() =>
                void (async () => {
                  try {
                    setNotice(describeExport(await api.finance.exportCsv()) || null);
                  } catch (err) {
                    setError(err instanceof Error ? err.message : String(err));
                  }
                })()
              }
            >
              Export CSV
            </button>
          </>
        }
      />
      <Banners error={error} notice={notice} />
      <p className="muted fin-note">
        A manual ledger. Entries come only from you or a CSV you import; nothing here connects to a
        bank, moves money or trades, and JARVIS cannot add entries.
      </p>
      {summary && (
        <div className="stat-row">
          <div className="stat-card">
            <span>Income</span>
            <strong>{formatCents(summary.incomeCents)}</strong>
          </div>
          <div className="stat-card">
            <span>Spent</span>
            <strong>{formatCents(summary.expenseCents)}</strong>
          </div>
          <div className="stat-card">
            <span>Net</span>
            <strong className={summary.netCents < 0 ? 'neg' : ''}>
              {formatCents(summary.netCents)}
            </strong>
          </div>
        </div>
      )}
      {summary && summary.byCategory.length > 0 && (
        <div className="fin-cats">
          {summary.byCategory.slice(0, 6).map((entry) => (
            <div key={entry.category} className="fin-cat">
              <span>{entry.category || 'Uncategorised'}</span>
              <div className="bar">
                <i
                  style={{
                    width: `${largest ? Math.max(4, (entry.totalCents / largest) * 100) : 0}%`,
                  }}
                />
              </div>
              <em>{formatCents(entry.totalCents)}</em>
            </div>
          ))}
        </div>
      )}
      <form
        className="app-form wrap"
        onSubmit={(event) => {
          event.preventDefault();
          add();
        }}
      >
        <input
          className="input"
          type="date"
          value={date}
          onChange={(e) => setDate(e.target.value)}
        />
        <select
          className="input"
          value={kind}
          onChange={(e) => setKind(e.target.value as 'expense' | 'income')}
        >
          <option value="expense">Expense</option>
          <option value="income">Income</option>
        </select>
        <input
          className="input"
          placeholder="Amount"
          inputMode="decimal"
          value={amount}
          onChange={(e) => setAmount(e.target.value)}
        />
        <input
          className="input grow"
          placeholder="Description"
          value={description}
          maxLength={200}
          onChange={(e) => setDescription(e.target.value)}
        />
        <input
          className="input"
          placeholder="Category"
          value={category}
          maxLength={60}
          onChange={(e) => setCategory(e.target.value)}
        />
        <input
          className="input"
          placeholder="Account"
          value={account}
          maxLength={60}
          onChange={(e) => setAccount(e.target.value)}
        />
        <button
          type="submit"
          className="btn primary"
          disabled={!description.trim() || !amount.trim()}
        >
          Add
        </button>
      </form>
      <div className="tab-body">
        {transactions.length === 0 && <div className="empty">No entries for {month}.</div>}
        {transactions.map((entry) => (
          <div key={entry.id} className="list-row">
            <div className="list-main">
              <div className="list-title">{entry.description}</div>
              <div className="list-sub">
                {entry.date}
                {entry.category && ` · ${entry.category}`}
                {entry.account && ` · ${entry.account}`}
              </div>
            </div>
            <strong className={entry.amountCents < 0 ? 'neg' : 'pos'}>
              {formatCents(entry.amountCents)}
            </strong>
            <ConfirmButton
              label="Delete"
              confirmLabel="Delete entry"
              onConfirm={() => void run(() => api.finance.remove(entry.id))}
            />
          </div>
        ))}
      </div>
    </div>
  );
}
