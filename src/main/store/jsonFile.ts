import fs from 'node:fs';
import path from 'node:path';

const WRITE_DELAY_MS = 400;

const openFiles = new Set<JsonFile<unknown>>();

/** Write every pending file synchronously — call on app quit so nothing is lost. */
export function flushAllJsonFiles(): void {
  for (const file of openFiles) file.flushSync();
}

/**
 * A small JSON document persisted next to the app data. Reads are synchronous at startup;
 * writes are debounced and atomic (temp file + rename) so a crash never leaves half a file.
 * A corrupt file is moved aside (`.corrupt-<time>`) rather than overwritten.
 */
export class JsonFile<T> {
  private data: T;
  private timer: ReturnType<typeof setTimeout> | null = null;
  private dirty = false;

  constructor(
    private readonly filePath: string,
    createDefault: () => T,
    migrate?: (raw: unknown) => T | null,
  ) {
    this.data = this.load(createDefault, migrate);
    openFiles.add(this as JsonFile<unknown>);
  }

  get value(): T {
    return this.data;
  }

  /** Replace the document and schedule a write. */
  set(next: T): void {
    this.data = next;
    this.touch();
  }

  /** Mark the in-memory document as changed (after mutating `value` in place). */
  touch(): void {
    this.dirty = true;
    if (this.timer) clearTimeout(this.timer);
    this.timer = setTimeout(() => this.flushSync(), WRITE_DELAY_MS);
  }

  flushSync(): void {
    if (this.timer) {
      clearTimeout(this.timer);
      this.timer = null;
    }
    if (!this.dirty) return;
    try {
      fs.mkdirSync(path.dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.tmp`;
      fs.writeFileSync(tmp, JSON.stringify(this.data), 'utf8');
      fs.renameSync(tmp, this.filePath);
      this.dirty = false;
    } catch (error) {
      console.error(`[ai-os] could not save ${this.filePath}:`, error);
    }
  }

  private load(createDefault: () => T, migrate?: (raw: unknown) => T | null): T {
    let text: string;
    try {
      text = fs.readFileSync(this.filePath, 'utf8');
    } catch {
      return createDefault();
    }
    try {
      const raw: unknown = JSON.parse(text);
      const migrated = migrate ? migrate(raw) : (raw as T);
      if (migrated !== null && migrated !== undefined) return migrated;
    } catch {
      // fall through to quarantine below
    }
    try {
      fs.renameSync(this.filePath, `${this.filePath}.corrupt-${Date.now()}`);
    } catch {
      // best effort
    }
    return createDefault();
  }
}
