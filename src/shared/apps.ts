/** Shared data contracts for the Tasks, Calendar, Finance and System Monitor apps. */

export type RecordSource = 'user' | 'jarvis';

/* ---------------- tasks ---------------- */

export type TaskStatus = 'todo' | 'doing' | 'done';
export type TaskPriority = 'low' | 'normal' | 'high';

export interface TaskRecord {
  id: string;
  title: string;
  notes: string;
  status: TaskStatus;
  priority: TaskPriority;
  /** Due date as YYYY-MM-DD, or null. */
  due: string | null;
  createdAt: number;
  updatedAt: number;
  completedAt: number | null;
  source: RecordSource;
}

export interface TaskInput {
  title: string;
  notes?: string;
  priority?: TaskPriority;
  due?: string | null;
}

export type TaskPatch = Partial<
  Pick<TaskRecord, 'title' | 'notes' | 'status' | 'priority' | 'due'>
>;

/* ---------------- calendar ---------------- */

export interface EventRecord {
  id: string;
  title: string;
  /** Epoch milliseconds. All-day events start at local midnight. */
  start: number;
  end: number;
  allDay: boolean;
  location: string;
  notes: string;
  createdAt: number;
  updatedAt: number;
  source: RecordSource;
}

export interface EventInput {
  title: string;
  start: number;
  end?: number;
  allDay?: boolean;
  location?: string;
  notes?: string;
}

export type EventPatch = Partial<Omit<EventInput, 'end'> & { end: number }>;

export interface ImportResult {
  ok: boolean;
  canceled?: boolean;
  imported: number;
  skipped: number;
  notes: string[];
  error?: string;
}

/* ---------------- finance (manual entry and import only) ---------------- */

export interface TransactionRecord {
  id: string;
  /** YYYY-MM-DD */
  date: string;
  /** Signed whole cents: negative = money out, positive = money in. */
  amountCents: number;
  description: string;
  category: string;
  account: string;
  createdAt: number;
  updatedAt: number;
}

export interface TransactionInput {
  date: string;
  amountCents: number;
  description: string;
  category?: string;
  account?: string;
}

export type TransactionPatch = Partial<TransactionInput>;

export interface FinanceSummary {
  /** YYYY-MM */
  month: string;
  incomeCents: number;
  expenseCents: number;
  netCents: number;
  transactionCount: number;
  /** Spending per category (largest first); expenses only, as positive cents. */
  byCategory: Array<{ category: string; totalCents: number }>;
}

/* ---------------- system monitor ---------------- */

export interface MonitorProcess {
  name: string;
  memoryMb: number;
  cpu: number;
}

export interface MonitorSnapshot {
  at: number;
  cpu: number;
  perCore: number[];
  ramPercent: number;
  ramUsedMb: number;
  ramTotalMb: number;
  diskPercent: number | null;
  diskFreeGb: number | null;
  uptimeSec: number;
  /** AI OS's own processes. */
  processes: MonitorProcess[];
}

/* ---------------- validation helpers shared by main and renderer ---------------- */

export function isDateString(value: unknown): value is string {
  if (typeof value !== 'string' || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const [year, month, day] = value.split('-').map(Number);
  const date = new Date(Date.UTC(year, month - 1, day));
  return (
    date.getUTCFullYear() === year && date.getUTCMonth() === month - 1 && date.getUTCDate() === day
  );
}

/** Format cents as a plain decimal string, e.g. -1234 → "-12.34". */
export function formatCents(cents: number): string {
  const sign = cents < 0 ? '-' : '';
  const abs = Math.abs(cents);
  return `${sign}${Math.floor(abs / 100)}.${String(abs % 100).padStart(2, '0')}`;
}
