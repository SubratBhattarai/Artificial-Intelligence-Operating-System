import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import path from 'node:path';
import type {
  FileIndexOverview,
  FileSearchHit,
  IndexedFile,
  IndexedFolder,
  IndexProgress,
  IndexStatus,
} from '../../shared/protocol';
import { makeSnippet } from '../../shared/text';
import { Bm25Index } from '../search/bm25';
import { JsonFile } from '../store/jsonFile';
import { chunkSections, type ChunkRecord } from './chunk';
import {
  classifyFile,
  extensionOf,
  extractFromBuffer,
  MAX_BINARY_BYTES,
  MAX_TEXT_BYTES,
  type Extraction,
} from './extract';

const MAX_FILES = 50_000;
const MAX_DEPTH = 12;
const MAX_PROBLEMS_LISTED = 100;
const PROGRESS_INTERVAL_MS = 150;
const SKIP_DIRECTORIES = new Set([
  'node_modules',
  '$recycle.bin',
  'system volume information',
  '__pycache__',
  'venv',
  'dist',
  'build',
  'site-packages',
]);

interface IndexData {
  version: 1;
  folders: IndexedFolder[];
  files: Record<string, IndexedFile>;
  chunks: Record<string, ChunkRecord[]>;
}

export interface RetrievedChunk {
  chunkId: string;
  fileId: string;
  path: string;
  name: string;
  section: string;
  text: string;
  modifiedAt: number;
  score: number;
}

export interface LoadedDocument {
  ok: boolean;
  path: string;
  name: string;
  reason?: string;
  modifiedAt?: number;
  chunks: ChunkRecord[];
  /** True when the text came from the index rather than a fresh read. */
  fromIndex: boolean;
}

const CASE_INSENSITIVE = process.platform === 'win32' || process.platform === 'darwin';

function pathKey(target: string): string {
  const resolved = path.resolve(target);
  return CASE_INSENSITIVE ? resolved.toLowerCase() : resolved;
}

export function fileIdFor(target: string): string {
  return createHash('sha1').update(pathKey(target)).digest('hex').slice(0, 16);
}

export function isInside(folder: string, target: string): boolean {
  const relative = path.relative(pathKey(folder), pathKey(target));
  return relative === '' || (!relative.startsWith('..') && !path.isAbsolute(relative));
}

function describeFsError(error: unknown): string {
  const code = (error as NodeJS.ErrnoException | undefined)?.code;
  switch (code) {
    case 'EACCES':
    case 'EPERM':
      return 'permission denied';
    case 'EBUSY':
      return 'the file is locked by another program';
    case 'ENOENT':
      return 'the file disappeared while indexing';
    default:
      return error instanceof Error ? error.message : String(error);
  }
}

function yieldToEventLoop(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

interface WalkEntry {
  path: string;
  name: string;
  size: number;
  mtimeMs: number;
}

async function* walk(root: string, signal?: AbortSignal): AsyncGenerator<WalkEntry> {
  const stack: Array<{ dir: string; depth: number }> = [{ dir: root, depth: 0 }];
  while (stack.length > 0) {
    if (signal?.aborted) return;
    const { dir, depth } = stack.pop()!;
    let dirents: import('node:fs').Dirent[];
    try {
      dirents = await fs.readdir(dir, { withFileTypes: true });
    } catch {
      continue;
    }
    for (const dirent of dirents) {
      if (signal?.aborted) return;
      if (dirent.name.startsWith('.') || dirent.isSymbolicLink()) continue;
      const full = path.join(dir, dirent.name);
      if (dirent.isDirectory()) {
        if (depth < MAX_DEPTH && !SKIP_DIRECTORIES.has(dirent.name.toLowerCase())) {
          stack.push({ dir: full, depth: depth + 1 });
        }
      } else if (dirent.isFile()) {
        try {
          const stats = await fs.stat(full);
          yield { path: full, name: dirent.name, size: stats.size, mtimeMs: stats.mtimeMs };
        } catch {
          // vanished or locked between readdir and stat; skip
        }
      }
    }
  }
}

export interface FileIndexOptions {
  /** Called whenever the set of user-selected folders changes (also once at startup). */
  onFoldersChanged?: (folders: string[]) => void;
}

/**
 * Metadata + text index over folders the user explicitly selected. Source files are only ever
 * read. Changed files (size/mtime) are re-indexed, vanished files are dropped, and identical
 * content found at several paths is grouped so search shows it once.
 */
export class FileIndex {
  private readonly file: JsonFile<IndexData>;
  private readonly bm25 = new Bm25Index();
  private duplicateCache: Map<string, string[]> | null = null;
  private running = false;
  private lastProgress: IndexProgress = emptyProgress('idle');

  constructor(
    dataDir: string,
    private readonly options: FileIndexOptions = {},
  ) {
    this.file = new JsonFile<IndexData>(
      path.join(dataDir, 'file-index.json'),
      () => ({ version: 1, folders: [], files: {}, chunks: {} }),
      (raw) => {
        const data = raw as Partial<IndexData> | null;
        if (
          !data ||
          !Array.isArray(data.folders) ||
          typeof data.files !== 'object' ||
          !data.files
        ) {
          return null;
        }
        return {
          version: 1,
          folders: data.folders,
          files: data.files as Record<string, IndexedFile>,
          chunks: (data.chunks ?? {}) as Record<string, ChunkRecord[]>,
        };
      },
    );
    for (const fileId of Object.keys(this.data.files)) this.addToSearch(fileId);
    this.options.onFoldersChanged?.(this.folderPaths());
  }

  private get data(): IndexData {
    return this.file.value;
  }

  get isRunning(): boolean {
    return this.running;
  }

  folderPaths(): string[] {
    return this.data.folders.map((folder) => folder.path);
  }

  folders(): IndexedFolder[] {
    return this.data.folders.map((folder) => ({ ...folder }));
  }

  /* ---------------------------- folders ---------------------------- */

  async addFolder(target: string, now = Date.now()): Promise<IndexedFolder> {
    const resolved = path.resolve(target);
    const stats = await fs.stat(resolved);
    if (!stats.isDirectory()) throw new Error('That path is not a folder.');

    const covering = this.data.folders.find((folder) => isInside(folder.path, resolved));
    if (covering) return { ...covering };

    // A parent replaces any previously selected children; their files are re-seen on the next scan.
    this.data.folders = this.data.folders.filter((folder) => !isInside(resolved, folder.path));
    const folder: IndexedFolder = { path: resolved, addedAt: now, lastIndexedAt: null };
    this.data.folders.push(folder);
    this.file.touch();
    this.options.onFoldersChanged?.(this.folderPaths());
    return { ...folder };
  }

  /** Stop indexing a folder and forget everything that was indexed from it. */
  removeFolder(target: string): number {
    const resolved = path.resolve(target);
    const before = this.data.folders.length;
    this.data.folders = this.data.folders.filter(
      (folder) => pathKey(folder.path) !== pathKey(resolved),
    );
    if (this.data.folders.length === before) return 0;
    let removed = 0;
    for (const fileId of Object.keys(this.data.files)) {
      const record = this.data.files[fileId];
      const stillCovered = this.data.folders.some((folder) => isInside(folder.path, record.path));
      if (!stillCovered) {
        this.dropFile(fileId);
        removed += 1;
      }
    }
    this.duplicateCache = null;
    this.file.touch();
    this.options.onFoldersChanged?.(this.folderPaths());
    return removed;
  }

  /* ---------------------------- indexing --------------------------- */

  async reindex(
    options: {
      folder?: string;
      signal?: AbortSignal;
      onProgress?: (progress: IndexProgress) => void;
    } = {},
  ): Promise<IndexProgress> {
    if (this.running) throw new Error('Indexing is already running.');
    const targets = options.folder
      ? this.data.folders.filter((folder) => pathKey(folder.path) === pathKey(options.folder!))
      : [...this.data.folders];
    if (targets.length === 0) throw new Error('Choose a folder to index first.');

    this.running = true;
    const progress = emptyProgress('scanning');
    let lastEmit = 0;
    const emit = (force = false) => {
      const now = Date.now();
      if (!force && now - lastEmit < PROGRESS_INTERVAL_MS) return;
      lastEmit = now;
      this.lastProgress = { ...progress };
      options.onProgress?.({ ...progress });
    };

    try {
      let totalSeen = 0;
      for (const folder of targets) {
        progress.folder = folder.path;
        try {
          await fs.access(folder.path);
        } catch {
          progress.message = `Folder not found, kept as-is: ${folder.path}`;
          continue;
        }

        const seen = new Set<string>();
        let complete = true;
        for await (const entry of walk(folder.path, options.signal)) {
          if (totalSeen >= MAX_FILES) {
            complete = false;
            progress.message = `Stopped at ${MAX_FILES.toLocaleString()} files.`;
            break;
          }
          totalSeen += 1;
          progress.scanned += 1;
          seen.add(fileIdFor(entry.path));
          await this.indexOne(entry, progress);
          emit();
          await yieldToEventLoop();
        }

        if (options.signal?.aborted) break;
        if (complete) {
          for (const fileId of Object.keys(this.data.files)) {
            const record = this.data.files[fileId];
            if (isInside(folder.path, record.path) && !seen.has(fileId)) {
              this.dropFile(fileId);
              progress.removed += 1;
            }
          }
          folder.lastIndexedAt = Date.now();
        }
      }
      progress.phase = options.signal?.aborted ? 'cancelled' : 'done';
    } catch (error) {
      progress.phase = 'error';
      progress.message = error instanceof Error ? error.message : String(error);
    } finally {
      this.running = false;
      this.duplicateCache = null;
      this.file.touch();
      emit(true);
    }
    return { ...progress };
  }

  private async indexOne(entry: WalkEntry, progress: IndexProgress): Promise<void> {
    const fileId = fileIdFor(entry.path);
    const existing = this.data.files[fileId];
    const unchanged =
      existing && existing.size === entry.size && existing.mtimeMs === entry.mtimeMs;
    if (unchanged && existing.status !== 'unreadable') {
      progress.unchanged += 1;
      return;
    }

    const ext = extensionOf(entry.name);
    const kind = classifyFile(ext);
    const base: IndexedFile = {
      id: fileId,
      path: entry.path,
      name: entry.name,
      ext,
      size: entry.size,
      mtimeMs: entry.mtimeMs,
      hash: null,
      status: 'indexed',
      chunkCount: 0,
      indexedAt: Date.now(),
    };

    const finish = (record: IndexedFile, chunks: ChunkRecord[]) => {
      this.dropFile(fileId);
      this.data.files[fileId] = record;
      if (chunks.length > 0) this.data.chunks[fileId] = chunks;
      this.addToSearch(fileId);
      if (record.status === 'indexed') progress.indexed += 1;
      if (record.status === 'unreadable') progress.unreadable += 1;
    };

    if (kind === 'other' || kind === 'image') {
      finish(
        {
          ...base,
          status: 'unsupported',
          reason: `.${ext || 'this'} files are not text-searchable; name and date are still searchable`,
        },
        [],
      );
      return;
    }

    const limit = kind === 'text' || kind === 'markdown' ? MAX_TEXT_BYTES : MAX_BINARY_BYTES;
    if (entry.size > limit) {
      finish(
        {
          ...base,
          status: 'skipped',
          reason: `larger than ${Math.round(limit / (1024 * 1024))} MB`,
        },
        [],
      );
      return;
    }

    let buffer: Buffer;
    try {
      buffer = await fs.readFile(entry.path);
    } catch (error) {
      finish({ ...base, status: 'unreadable', reason: describeFsError(error) }, []);
      return;
    }

    const extraction: Extraction = await extractFromBuffer(buffer, kind);
    if (!extraction.ok) {
      finish({ ...base, status: extraction.status, reason: extraction.reason }, []);
      return;
    }
    const chunks = chunkSections(extraction.sections);
    finish(
      {
        ...base,
        hash: createHash('sha1').update(buffer).digest('hex'),
        chunkCount: chunks.length,
      },
      chunks,
    );
  }

  /* ----------------------------- storage --------------------------- */

  private addToSearch(fileId: string): void {
    const record = this.data.files[fileId];
    if (!record) return;
    // File names are searchable even when the contents are not (images, spreadsheets, ...).
    this.bm25.add(`f:${fileId}`, `${record.name} ${record.path.replace(/[\\/]/g, ' ')}`);
    const chunks = this.data.chunks[fileId] ?? [];
    chunks.forEach((chunk, index) => {
      this.bm25.add(`c:${fileId}#${index}`, `${chunk.section}\n${chunk.text}`);
    });
  }

  private dropFile(fileId: string): void {
    const record = this.data.files[fileId];
    this.bm25.remove(`f:${fileId}`);
    const chunks = this.data.chunks[fileId] ?? [];
    for (let index = 0; index < Math.max(chunks.length, record?.chunkCount ?? 0); index += 1) {
      this.bm25.remove(`c:${fileId}#${index}`);
    }
    delete this.data.chunks[fileId];
    delete this.data.files[fileId];
  }

  private duplicateGroups(): Map<string, string[]> {
    if (this.duplicateCache) return this.duplicateCache;
    const byHash = new Map<string, string[]>();
    for (const record of Object.values(this.data.files)) {
      if (record.status !== 'indexed' || !record.hash) continue;
      const group = byHash.get(record.hash) ?? [];
      group.push(record.id);
      byHash.set(record.hash, group);
    }
    const groups = new Map<string, string[]>();
    for (const [hash, ids] of byHash) {
      if (ids.length < 2) continue;
      ids.sort((a, b) => this.data.files[a].path.localeCompare(this.data.files[b].path));
      groups.set(hash, ids);
    }
    this.duplicateCache = groups;
    return groups;
  }

  /* ------------------------------ queries -------------------------- */

  statusOf(target: string): { status: IndexStatus; reason?: string } | null {
    const record = this.data.files[fileIdFor(target)];
    return record ? { status: record.status, reason: record.reason } : null;
  }

  getFile(target: string): IndexedFile | null {
    return this.data.files[fileIdFor(target)] ?? null;
  }

  overview(): FileIndexOverview {
    const totals = {
      files: 0,
      indexed: 0,
      unreadable: 0,
      unsupported: 0,
      skipped: 0,
      chunks: 0,
      duplicateGroups: this.duplicateGroups().size,
    };
    const problems: IndexedFile[] = [];
    for (const record of Object.values(this.data.files)) {
      totals.files += 1;
      totals[record.status] += 1;
      totals.chunks += record.chunkCount;
      if (
        (record.status === 'unreadable' || record.status === 'skipped') &&
        problems.length < MAX_PROBLEMS_LISTED
      ) {
        problems.push({ ...record });
      }
    }
    return {
      folders: this.folders(),
      totals,
      progress: { ...this.lastProgress },
      problems,
    };
  }

  /** One result per distinct document (duplicates collapsed), best passage first. */
  search(query: string, limit = 20): FileSearchHit[] {
    const raw = this.bm25.search(query, Math.max(limit * 6, 30));
    const groups = this.duplicateGroups();
    const best = new Map<string, FileSearchHit>();

    for (const hit of raw) {
      const isChunk = hit.id.startsWith('c:');
      const key = hit.id.slice(2);
      const [fileId, indexText] = isChunk ? key.split('#') : [key, ''];
      const record = this.data.files[fileId];
      if (!record) continue;
      const group = record.hash ? groups.get(record.hash) : undefined;
      const canonicalId = group ? group[0] : fileId;
      if (best.has(canonicalId)) continue;
      const canonical = this.data.files[canonicalId];
      if (!canonical) continue;

      let section = 'file name';
      let snippet = canonical.path;
      let chunkId = `${canonicalId}#-1`;
      if (isChunk) {
        const chunk = this.data.chunks[canonicalId]?.[Number(indexText)];
        if (!chunk) continue;
        section = chunk.section;
        snippet = makeSnippet(chunk.text, query, 260);
        chunkId = `${canonicalId}#${indexText}`;
      }
      best.set(canonicalId, {
        fileId: canonicalId,
        chunkId,
        path: canonical.path,
        name: canonical.name,
        modifiedAt: canonical.mtimeMs,
        size: canonical.size,
        section,
        snippet,
        score: Math.round(hit.score * 100) / 100,
        duplicates: (group ?? [])
          .filter((id) => id !== canonicalId)
          .map((id) => this.data.files[id]?.path)
          .filter((value): value is string => Boolean(value)),
      });
      if (best.size >= limit) break;
    }
    return [...best.values()];
  }

  /** Top passages for answering a question, with at most `perFile` passages from one document. */
  topChunks(question: string, limit = 6, perFile = 3): RetrievedChunk[] {
    const raw = this.bm25.search(question, limit * 8, (id) => id.startsWith('c:'));
    const groups = this.duplicateGroups();
    const perFileCount = new Map<string, number>();
    const result: RetrievedChunk[] = [];
    for (const hit of raw) {
      const [fileId, indexText] = hit.id.slice(2).split('#');
      const record = this.data.files[fileId];
      if (!record) continue;
      const group = record.hash ? groups.get(record.hash) : undefined;
      if (group && group[0] !== fileId) continue; // identical content is represented once
      const used = perFileCount.get(fileId) ?? 0;
      if (used >= perFile) continue;
      const chunk = this.data.chunks[fileId]?.[Number(indexText)];
      if (!chunk) continue;
      perFileCount.set(fileId, used + 1);
      result.push({
        chunkId: `${fileId}#${indexText}`,
        fileId,
        path: record.path,
        name: record.name,
        section: chunk.section,
        text: chunk.text,
        modifiedAt: record.mtimeMs,
        score: hit.score,
      });
      if (result.length >= limit) break;
    }
    return result;
  }

  /** Files that match the question by name but whose contents could not be used. */
  unreadableMatches(question: string, limit = 5): IndexedFile[] {
    const hits = this.bm25.search(question, 60, (id) => id.startsWith('f:'));
    const result: IndexedFile[] = [];
    for (const hit of hits) {
      const record = this.data.files[hit.id.slice(2)];
      if (record && record.status !== 'indexed') result.push({ ...record });
      if (result.length >= limit) break;
    }
    return result;
  }

  /** The full text of one file as chunks — from the index when current, otherwise read fresh. */
  async loadDocument(target: string): Promise<LoadedDocument> {
    const resolved = path.resolve(target);
    const name = path.basename(resolved);
    const fileId = fileIdFor(resolved);
    const record = this.data.files[fileId];

    let stats;
    try {
      stats = await fs.stat(resolved);
    } catch (error) {
      return {
        ok: false,
        path: resolved,
        name,
        reason: describeFsError(error),
        chunks: [],
        fromIndex: false,
      };
    }
    if (!stats.isFile()) {
      return {
        ok: false,
        path: resolved,
        name,
        reason: 'not a file',
        chunks: [],
        fromIndex: false,
      };
    }

    if (
      record &&
      record.status === 'indexed' &&
      record.size === stats.size &&
      record.mtimeMs === stats.mtimeMs
    ) {
      return {
        ok: true,
        path: resolved,
        name,
        modifiedAt: stats.mtimeMs,
        chunks: this.data.chunks[fileId] ?? [],
        fromIndex: true,
      };
    }

    const kind = classifyFile(extensionOf(name));
    if (kind === 'other') {
      return {
        ok: false,
        path: resolved,
        name,
        reason: 'this file type is not text-readable',
        chunks: [],
        fromIndex: false,
      };
    }
    const limit = kind === 'text' || kind === 'markdown' ? MAX_TEXT_BYTES : MAX_BINARY_BYTES;
    if (stats.size > limit) {
      return {
        ok: false,
        path: resolved,
        name,
        reason: 'the file is too large to read',
        chunks: [],
        fromIndex: false,
      };
    }
    try {
      const extraction = await extractFromBuffer(await fs.readFile(resolved), kind);
      if (!extraction.ok) {
        return {
          ok: false,
          path: resolved,
          name,
          reason: extraction.reason,
          chunks: [],
          fromIndex: false,
        };
      }
      return {
        ok: true,
        path: resolved,
        name,
        modifiedAt: stats.mtimeMs,
        chunks: chunkSections(extraction.sections),
        fromIndex: false,
      };
    } catch (error) {
      return {
        ok: false,
        path: resolved,
        name,
        reason: describeFsError(error),
        chunks: [],
        fromIndex: false,
      };
    }
  }

  flush(): void {
    this.file.flushSync();
  }
}

function emptyProgress(phase: IndexProgress['phase']): IndexProgress {
  return { phase, folder: null, scanned: 0, indexed: 0, unchanged: 0, unreadable: 0, removed: 0 };
}
