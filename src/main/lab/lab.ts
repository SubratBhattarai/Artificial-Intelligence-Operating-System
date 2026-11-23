import fs from 'node:fs/promises';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import {
  LAB_COMMANDS,
  isValidProjectName,
  type LabCommandId,
  type LabProject,
  type LabRunResult,
  type LabTemplate,
} from '../../shared/lab';
import { resolveWritable } from '../fs/safeWrite';
import { runProcess, type ProcessRunner } from '../system/runProcess';

export const LAB_FOLDER_NAME = 'AI OS Projects';
const RUN_TIMEOUT_MS = 5 * 60_000;

export function labRoot(): string {
  return path.join(os.homedir(), 'Documents', LAB_FOLDER_NAME);
}

export const TEMPLATES: Record<LabTemplate, Record<string, string>> = {
  'static-site': {
    'index.html':
      '<!doctype html>\n<html lang="en">\n<head>\n<meta charset="utf-8">\n<meta name="viewport" content="width=device-width,initial-scale=1">\n<title>My project</title>\n<link rel="stylesheet" href="style.css">\n</head>\n<body>\n<h1>Hello from the Lab</h1>\n<script src="script.js"></script>\n</body>\n</html>\n',
    'style.css': 'body { font-family: system-ui, sans-serif; margin: 2rem; }\n',
    'script.js': "console.log('Lab project ready');\n",
  },
  'node-script': {
    'package.json':
      '{\n  "name": "lab-project",\n  "version": "1.0.0",\n  "private": true,\n  "scripts": { "test": "node test.js" }\n}\n',
    'main.js': "console.log('Hello from the Lab');\n",
    'test.js':
      "const assert = require('node:assert');\nassert.strictEqual(1 + 1, 2);\nconsole.log('ok');\n",
  },
  'python-script': {
    'main.py': "print('Hello from the Lab')\n",
    'test_main.py': 'def test_math():\n    assert 1 + 1 == 2\n',
  },
};

const MIME: Record<string, string> = {
  '.html': 'text/html; charset=utf-8',
  '.css': 'text/css; charset=utf-8',
  '.js': 'text/javascript; charset=utf-8',
  '.json': 'application/json; charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.txt': 'text/plain; charset=utf-8',
};

/** Map a request URL to a file inside the project folder, or null when it would escape it. */
export function resolveStaticPath(projectDir: string, urlPath: string): string | null {
  let decoded: string;
  try {
    decoded = decodeURIComponent(urlPath.split('?')[0].split('#')[0]);
  } catch {
    return null;
  }
  if (decoded.includes('\0')) return null;
  const relative = decoded.endsWith('/') ? `${decoded}index.html` : decoded;
  const full = path.resolve(projectDir, `.${path.sep}${relative}`);
  const base = path.resolve(projectDir);
  return full === base || full.startsWith(base + path.sep) ? full : null;
}

export class LabManager {
  private readonly previews = new Map<string, { server: http.Server; port: number }>();

  constructor(
    private readonly root: string = labRoot(),
    private readonly runner: ProcessRunner = runProcess,
  ) {}

  async projectDir(name: string): Promise<string> {
    if (!isValidProjectName(name))
      throw new Error('Project names use lowercase letters, numbers and dashes.');
    const dir = path.join(this.root, name);
    // The projects folder is created on first use; the path check needs its parent to exist.
    await fs.mkdir(this.root, { recursive: true });
    await resolveWritable(dir); // must be inside an allowed folder
    return dir;
  }

  async list(): Promise<LabProject[]> {
    const entries = await fs.readdir(this.root, { withFileTypes: true }).catch(() => []);
    const projects: LabProject[] = [];
    for (const entry of entries) {
      if (!entry.isDirectory() || !isValidProjectName(entry.name)) continue;
      const files = await fs.readdir(path.join(this.root, entry.name)).catch(() => [] as string[]);
      const template = files.includes('index.html')
        ? 'static-site'
        : files.includes('main.js') || files.includes('package.json')
          ? 'node-script'
          : files.includes('main.py')
            ? 'python-script'
            : 'custom';
      projects.push({
        name: entry.name,
        template,
        hasPackageJson: files.includes('package.json'),
        previewPort: this.previews.get(entry.name)?.port ?? null,
      });
    }
    return projects.sort((a, b) => a.name.localeCompare(b.name));
  }

  async create(name: string, template: LabTemplate): Promise<string> {
    const dir = await this.projectDir(name);
    const exists = await fs.stat(dir).then(
      () => true,
      () => false,
    );
    if (exists) throw new Error(`A project called "${name}" already exists.`);
    await fs.mkdir(dir, { recursive: true });
    for (const [file, content] of Object.entries(TEMPLATES[template])) {
      await fs.writeFile(path.join(dir, file), content, { flag: 'wx' });
    }
    return dir;
  }

  async run(name: string, command: LabCommandId, signal?: AbortSignal): Promise<LabRunResult> {
    const dir = await this.projectDir(name);
    if (
      !(await fs.stat(dir).then(
        (s) => s.isDirectory(),
        () => false,
      ))
    )
      throw new Error('That project does not exist.');
    const text = LAB_COMMANDS[command];
    if (!text) throw new Error('Unknown Lab command.');
    const result = await this.runner(
      'powershell.exe',
      ['-NoProfile', '-NonInteractive', '-Command', text],
      {
        cwd: dir,
        timeoutMs: RUN_TIMEOUT_MS,
        signal,
      },
    );
    const output = [result.stdout, result.stderr].filter(Boolean).join('\n').trim();
    return { exitCode: result.exitCode, output: output.slice(-6000), timedOut: result.timedOut };
  }

  async startPreview(name: string): Promise<number> {
    const existing = this.previews.get(name);
    if (existing) return existing.port;
    const dir = await this.projectDir(name);
    if (
      !(await fs.stat(path.join(dir, 'index.html')).then(
        () => true,
        () => false,
      ))
    ) {
      throw new Error('Only projects with an index.html can be previewed.');
    }
    const server = http.createServer((req, res) => {
      void (async () => {
        const target = req.method === 'GET' ? resolveStaticPath(dir, req.url ?? '/') : null;
        try {
          if (!target) throw new Error('blocked');
          const real = await fs.realpath(target);
          const base = await fs.realpath(dir);
          if (!real.startsWith(base + path.sep)) throw new Error('blocked');
          const body = await fs.readFile(real);
          res.writeHead(200, {
            'Content-Type': MIME[path.extname(real).toLowerCase()] ?? 'application/octet-stream',
            'X-Content-Type-Options': 'nosniff',
            'Content-Security-Policy': "default-src 'self' 'unsafe-inline' data:",
          });
          res.end(body);
        } catch {
          res.writeHead(404, { 'Content-Type': 'text/plain' });
          res.end('Not found');
        }
      })();
    });
    const port = await new Promise<number>((resolve, reject) => {
      server.once('error', reject);
      server.listen(0, '127.0.0.1', () => resolve((server.address() as { port: number }).port));
    });
    this.previews.set(name, { server, port });
    return port;
  }

  stopPreview(name: string): boolean {
    const entry = this.previews.get(name);
    if (!entry) return false;
    entry.server.close();
    entry.server.closeAllConnections?.();
    this.previews.delete(name);
    return true;
  }

  previewUrl(name: string): string | null {
    const entry = this.previews.get(name);
    return entry ? `http://127.0.0.1:${entry.port}/` : null;
  }

  shutdown(): void {
    for (const name of [...this.previews.keys()]) this.stopPreview(name);
  }
}
