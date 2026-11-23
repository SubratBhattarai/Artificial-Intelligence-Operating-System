import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { chunkSections } from '../src/main/files/chunk';
import { askDocuments, buildDocsMessages } from '../src/main/files/docQa';
import { classifyFile } from '../src/main/files/extract';
import { FileIndex } from '../src/main/files/indexer';
import { isOpenable } from '../src/main/files/preview';
import { flushAllJsonFiles } from '../src/main/store/jsonFile';
import type { DocsEvent } from '../src/shared/protocol';
import type { ModelAdapter } from '../src/main/llm/adapter';

const dirs: string[] = [];

function tempDir(): string {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'aios-files-'));
  dirs.push(dir);
  return dir;
}

afterEach(() => {
  flushAllJsonFiles();
  for (const dir of dirs.splice(0)) fs.rmSync(dir, { recursive: true, force: true });
});

function makeCorpus(): { data: string; docs: string } {
  const data = tempDir();
  const docs = tempDir();
  fs.writeFileSync(
    path.join(docs, 'plan.md'),
    '# Overview\nThis is the project plan.\n\n## Budget\nThe budget for the robotics club is 4000 dollars.\n\n## Timeline\nKickoff happens in September.\n',
  );
  fs.writeFileSync(
    path.join(docs, 'notes.txt'),
    'Line one\nThe quarterly report is due Friday\nLine three\n',
  );
  fs.copyFileSync(path.join(docs, 'notes.txt'), path.join(docs, 'notes-copy.txt'));
  fs.writeFileSync(
    path.join(docs, 'broken.txt'),
    Buffer.from([0x41, 0x00, 0x42, 0x00, 0x00, 0x01, 0x02]),
  );
  fs.writeFileSync(path.join(docs, 'photo.bmp'), Buffer.from('BM-not-really-an-image'));
  fs.mkdirSync(path.join(docs, 'sub'));
  fs.writeFileSync(path.join(docs, 'sub', 'deep.md'), '# Deep\nHidden gem about telescopes.\n');
  fs.writeFileSync(path.join(docs, '.secret.txt'), 'dotfiles must never be indexed');
  return { data, docs };
}

describe('FileIndex', () => {
  it('indexes selected folders: statuses, sections, duplicates', async () => {
    const { data, docs } = makeCorpus();
    const index = new FileIndex(data);
    await index.addFolder(docs);
    const progress = await index.reindex();
    expect(progress.phase).toBe('done');

    const overview = index.overview();
    expect(overview.totals.indexed).toBe(4); // plan.md, notes.txt, notes-copy.txt, deep.md
    expect(overview.totals.unreadable).toBe(1); // broken.txt
    expect(overview.totals.unsupported).toBe(1); // photo.bmp
    expect(overview.totals.duplicateGroups).toBe(1);
    expect(overview.problems.map((file) => file.name)).toEqual(['broken.txt']);
    expect(overview.problems[0].reason).toContain('binary');

    // dotfiles are never indexed
    expect(index.getFile(path.join(docs, '.secret.txt'))).toBeNull();
  });

  it('searches with path, modified date, section and snippet; collapses duplicates', async () => {
    const { data, docs } = makeCorpus();
    const index = new FileIndex(data);
    await index.addFolder(docs);
    await index.reindex();

    const budget = index.search('robotics budget');
    expect(budget[0].name).toBe('plan.md');
    expect(budget[0].section).toContain('Budget');
    expect(budget[0].snippet).toContain('4000');
    expect(budget[0].modifiedAt).toBeGreaterThan(0);
    expect(budget[0].path).toContain('plan.md');

    const report = index.search('quarterly report');
    expect(report).toHaveLength(1); // duplicate copy collapsed
    expect(report[0].duplicates).toHaveLength(1);
    expect(report[0].section).toContain('lines');

    // file names are searchable even when contents are not
    expect(index.search('photo')[0].name).toBe('photo.bmp');
    expect(index.search('telescopes')[0].name).toBe('deep.md');
  });

  it('re-indexes changed files and drops removed ones', async () => {
    const { data, docs } = makeCorpus();
    const index = new FileIndex(data);
    await index.addFolder(docs);
    await index.reindex();

    const unchanged = await index.reindex();
    expect(unchanged.indexed).toBe(0);
    expect(unchanged.unchanged).toBeGreaterThan(0);

    const target = path.join(docs, 'notes.txt');
    fs.writeFileSync(target, 'Completely different content about volcanoes\n');
    const future = new Date(Date.now() + 5000);
    fs.utimesSync(target, future, future);
    fs.rmSync(path.join(docs, 'sub', 'deep.md'));

    const progress = await index.reindex();
    expect(progress.indexed).toBeGreaterThanOrEqual(1);
    expect(progress.removed).toBe(1);
    expect(index.search('volcanoes')).toHaveLength(1);
    // the unchanged copy keeps its old content; only the edited file changed
    expect(index.search('quarterly').map((hit) => hit.name)).toEqual(['notes-copy.txt']);
    expect(index.search('telescopes')).toHaveLength(0);
    // the former duplicate no longer matches content, so the group is gone
    expect(index.overview().totals.duplicateGroups).toBe(0);
  });

  it('persists the index across restarts and forgets a removed folder', async () => {
    const { data, docs } = makeCorpus();
    const first = new FileIndex(data);
    await first.addFolder(docs);
    await first.reindex();
    first.flush();

    const second = new FileIndex(data);
    expect(second.folderPaths()).toHaveLength(1);
    expect(second.search('telescopes')).toHaveLength(1);
    expect(second.removeFolder(docs)).toBeGreaterThan(0);
    expect(second.search('telescopes')).toHaveLength(0);
    expect(second.overview().totals.files).toBe(0);
  });

  it('can be cancelled', async () => {
    const { data, docs } = makeCorpus();
    const index = new FileIndex(data);
    await index.addFolder(docs);
    const controller = new AbortController();
    controller.abort();
    const progress = await index.reindex({ signal: controller.signal });
    expect(progress.phase).toBe('cancelled');
  });

  it('reads documents on demand and reports unreadable files with a reason', async () => {
    const { data, docs } = makeCorpus();
    const index = new FileIndex(data);
    const ok = await index.loadDocument(path.join(docs, 'plan.md'));
    expect(ok.ok).toBe(true);
    expect(ok.chunks.some((chunk) => chunk.section.includes('Timeline'))).toBe(true);
    const bad = await index.loadDocument(path.join(docs, 'broken.txt'));
    expect(bad.ok).toBe(false);
    expect(bad.reason).toContain('binary');
    const missing = await index.loadDocument(path.join(docs, 'nope.txt'));
    expect(missing.ok).toBe(false);
  });

  it('refuses nested folder duplicates and replaces children with a parent', async () => {
    const { data, docs } = makeCorpus();
    const index = new FileIndex(data);
    await index.addFolder(path.join(docs, 'sub'));
    await index.addFolder(docs);
    expect(index.folderPaths()).toEqual([path.resolve(docs)]);
    await index.addFolder(path.join(docs, 'sub'));
    expect(index.folderPaths()).toHaveLength(1);
  });

  it('retrieves cited passages and lists unreadable matches for document Q&A', async () => {
    const { data, docs } = makeCorpus();
    const index = new FileIndex(data);
    await index.addFolder(docs);
    await index.reindex();

    const chunks = index.topChunks('what is the robotics club budget');
    expect(chunks[0].name).toBe('plan.md');
    expect(buildDocsMessages('q', chunks)[1].content).toContain('[1] plan.md › ');

    const unreadable = index.unreadableMatches('what is in broken');
    expect(unreadable.map((file) => file.name)).toEqual(['broken.txt']);

    const events: DocsEvent[] = [];
    const adapter: ModelAdapter = {
      id: 'ollama',
      model: 'fake',
      configured: true,
      ping: async () => true,
      stream: async ({ onText }) => {
        onText('The budget is 4000 dollars [1].');
        return { finishReason: 'stop', toolCalls: [] };
      },
    };
    await askDocuments({
      requestId: 'r1',
      question: 'what is the robotics club budget',
      adapter,
      index,
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
    });
    const kinds = events.map((event) => event.type);
    expect(kinds[0]).toBe('sources');
    expect(kinds).toContain('text');
    expect(kinds[kinds.length - 1]).toBe('done');
    const sources = events[0].type === 'sources' ? events[0].sources : [];
    expect(sources[0].name).toBe('plan.md');
  });

  it('answers without calling the model when nothing matches', async () => {
    const { data, docs } = makeCorpus();
    const index = new FileIndex(data);
    await index.addFolder(docs);
    await index.reindex();
    let called = false;
    const adapter: ModelAdapter = {
      id: 'ollama',
      model: 'fake',
      configured: true,
      ping: async () => true,
      stream: async () => {
        called = true;
        return { finishReason: 'stop', toolCalls: [] };
      },
    };
    const events: DocsEvent[] = [];
    await askDocuments({
      requestId: 'r2',
      question: 'zebra quantum xylophone',
      adapter,
      index,
      signal: new AbortController().signal,
      emit: (event) => events.push(event),
    });
    expect(called).toBe(false);
    expect(events[events.length - 1].type).toBe('done');
  });
});

describe('extraction helpers', () => {
  it('classifies file types', () => {
    expect(classifyFile('md')).toBe('markdown');
    expect(classifyFile('PDF')).toBe('pdf');
    expect(classifyFile('docx')).toBe('docx');
    expect(classifyFile('py')).toBe('text');
    expect(classifyFile('exe')).toBe('other');
  });

  it('labels long text with line ranges and splits at the size limit', () => {
    const lines = Array.from(
      { length: 200 },
      (_, index) => `line number ${index + 1} with some filler words`,
    );
    const chunks = chunkSections([{ label: '', text: lines.join('\n'), lineStart: 1 }]);
    expect(chunks.length).toBeGreaterThan(1);
    expect(chunks[0].section).toBe(`lines 1–${chunks[0].text.split('\n').length}`);
    for (const chunk of chunks) expect(chunk.text.length).toBeLessThanOrEqual(1200);
  });

  it('never opens programs or scripts', () => {
    expect(isOpenable('report.pdf')).toBe(true);
    expect(isOpenable('setup.exe')).toBe(false);
    expect(isOpenable('run.ps1')).toBe(false);
    expect(isOpenable('x.PY')).toBe(false);
  });
});
