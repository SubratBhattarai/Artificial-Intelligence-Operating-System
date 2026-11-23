import { createRequire } from 'node:module';
import path from 'node:path';

/** Minimal shape of tesseract.js that we use; the package is optional until `npm install`. */
interface TesseractWorker {
  recognize(image: Buffer): Promise<{ data: { text: string } }>;
  terminate(): Promise<unknown>;
}
interface TesseractModule {
  createWorker(
    lang: string,
    oem?: number,
    options?: Record<string, unknown>,
  ): Promise<TesseractWorker>;
}

export interface OcrEngine {
  recognize(image: Buffer): Promise<string>;
  shutdown(): Promise<void>;
}

const IDLE_MS = 120_000;

/**
 * Offline text recognition. The English language file (about 15 MB) is downloaded once into
 * <userData>/ocr and read from disk afterwards. The worker is released after a period of no use.
 */
export function createOcrEngine(options: { appRoot: string; cacheDir: string }): OcrEngine {
  let worker: TesseractWorker | null = null;
  let starting: Promise<TesseractWorker> | null = null;
  let idle: ReturnType<typeof setTimeout> | null = null;

  const load = async (): Promise<TesseractWorker> => {
    if (worker) return worker;
    if (starting) return starting;
    starting = (async () => {
      let tesseract: TesseractModule;
      try {
        tesseract = createRequire(path.join(options.appRoot, 'package.json'))(
          'tesseract.js',
        ) as TesseractModule;
      } catch {
        throw new Error('Text recognition is not installed. Run `npm install` and restart AI OS.');
      }
      worker = await tesseract.createWorker('eng', 1, { cachePath: options.cacheDir });
      return worker;
    })();
    try {
      return await starting;
    } catch (error) {
      starting = null;
      throw error;
    }
  };

  const touch = () => {
    if (idle) clearTimeout(idle);
    idle = setTimeout(() => void shutdown(), IDLE_MS);
  };

  const shutdown = async (): Promise<void> => {
    if (idle) clearTimeout(idle);
    idle = null;
    const current = worker;
    worker = null;
    starting = null;
    if (current) await current.terminate().catch(() => undefined);
  };

  return {
    async recognize(image) {
      const engine = await load();
      try {
        const result = await engine.recognize(image);
        return result.data.text
          .replace(/\r/g, '')
          .replace(/\n{3,}/g, '\n\n')
          .trim();
      } finally {
        touch();
      }
    },
    shutdown,
  };
}
