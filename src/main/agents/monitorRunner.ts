import { createHash } from 'node:crypto';
import { normalizeForCompare } from '../web/text';
import { summarizeChange } from './importance';
import type { MonitorStore } from './stores';

const TICK_MS = 60_000;

export interface MonitorDeps {
  store: MonitorStore;
  /** Readable text of a page. Must enforce its own safety rules (public https only). */
  fetchText: (url: string, signal?: AbortSignal) => Promise<string>;
  /** Whether Web access is on right now. Checked on every run. */
  canRun: () => boolean;
  notify: (note: { title: string; body: string; key: string }) => void;
  now?: () => number;
}

const hashOf = (text: string): string =>
  createHash('sha256').update(normalizeForCompare(text)).digest('hex');

/** Watches pages while AI OS is open. Nothing runs when the app is closed or Web access is off. */
export class MonitorRunner {
  private timer: ReturnType<typeof setInterval> | null = null;
  private busy = false;
  private readonly now: () => number;

  constructor(private readonly deps: MonitorDeps) {
    this.now = deps.now ?? Date.now;
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), TICK_MS);
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  async tick(): Promise<void> {
    if (this.busy || !this.deps.canRun()) return;
    this.busy = true;
    try {
      const at = this.now();
      for (const monitor of this.deps.store.list()) {
        const due =
          !monitor.lastChecked || at - monitor.lastChecked >= monitor.intervalMinutes * 60_000;
        if (due) await this.check(monitor.id);
      }
    } finally {
      this.busy = false;
    }
  }

  async check(id: string): Promise<void> {
    const monitor = this.deps.store.get(id);
    if (!monitor || !this.deps.canRun()) return;
    const at = this.now();
    try {
      const text = await this.deps.fetchText(monitor.url);
      const previous = this.deps.store.lastText(id);
      if (previous === undefined) {
        this.deps.store.update(id, { lastChecked: at, error: undefined }, text);
        return;
      }
      if (hashOf(previous) === hashOf(text)) {
        this.deps.store.update(id, { lastChecked: at, error: undefined });
        return;
      }
      const summary = summarizeChange(previous, text);
      this.deps.store.update(
        id,
        {
          lastChecked: at,
          lastChange: at,
          changeSummary: summary,
          unseenChange: true,
          error: undefined,
        },
        text,
      );
      this.deps.notify({
        title: `${monitor.label} changed`,
        body: summary,
        key: `monitor-${id}-${at}`,
      });
    } catch (error) {
      this.deps.store.update(id, {
        lastChecked: at,
        error: (error instanceof Error ? error.message : String(error)).slice(0, 160),
      });
    }
  }
}
