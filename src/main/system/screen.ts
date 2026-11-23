import { desktopCapturer, screen, type BrowserWindow } from 'electron';
import type { ScreenReader } from '../tools/computerTools';
import type { OcrEngine } from './ocr';

const APP_TITLE = 'AI OS';

/**
 * One-shot screen reading. The screenshot lives only in memory for the moment it takes to read
 * its text, and the renderer is told when it starts and stops so a SCREEN indicator can show.
 */
export function createScreenReader(deps: {
  getWindow: () => BrowserWindow | null;
  ocr: OcrEngine;
  onActivity: (active: boolean) => void;
}): ScreenReader {
  return {
    async read({ window: title, signal }) {
      const win = deps.getWindow();
      deps.onActivity(true);
      let hidden = false;
      try {
        if (title) {
          const sources = await desktopCapturer.getSources({
            types: ['window'],
            thumbnailSize: { width: 1920, height: 1200 },
          });
          const wanted = title.toLowerCase();
          const match = sources.find(
            (source) =>
              source.name.toLowerCase().includes(wanted) && !source.name.includes(APP_TITLE),
          );
          if (!match) throw new Error(`No open window has “${title}” in its title.`);
          const png = match.thumbnail.toPNG();
          signal?.throwIfAborted();
          return {
            text: await deps.ocr.recognize(png),
            source: `the “${match.name.slice(0, 60)}” window`,
          };
        }
        if (win && !win.isDestroyed() && win.isVisible()) {
          win.hide();
          hidden = true;
          await new Promise((resolve) => setTimeout(resolve, 450));
        }
        const display = screen.getPrimaryDisplay();
        const width = Math.min(3840, Math.round(display.size.width * display.scaleFactor));
        const height = Math.min(2160, Math.round(display.size.height * display.scaleFactor));
        const sources = await desktopCapturer.getSources({
          types: ['screen'],
          thumbnailSize: { width, height },
        });
        const primary = sources[0];
        if (!primary) throw new Error('Windows did not provide a screen to capture.');
        const png = primary.thumbnail.toPNG();
        if (hidden && win && !win.isDestroyed()) {
          win.show();
          hidden = false;
        }
        signal?.throwIfAborted();
        return { text: await deps.ocr.recognize(png), source: 'the screen' };
      } finally {
        if (hidden && win && !win.isDestroyed()) win.show();
        deps.onActivity(false);
      }
    },
  };
}
