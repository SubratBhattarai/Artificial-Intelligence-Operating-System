import fs from 'node:fs';
import path from 'node:path';

const MAX_PHOTO_BYTES = 8 * 1024 * 1024;
const NAME = /^photo-\d{10,}\.(png|jpg)$/;
const DATA_URL = /^data:image\/(png|jpeg);base64,([A-Za-z0-9+/=]+)$/;

export interface PhotoInfo {
  name: string;
  bytes: number;
  takenAt: number;
}

/** Photos taken in the Camera app stay in AI OS's own data folder. */
export class PhotoStore {
  private readonly dir: string;

  constructor(dataDir: string) {
    this.dir = path.join(dataDir, 'photos');
  }

  list(): PhotoInfo[] {
    try {
      return fs
        .readdirSync(this.dir)
        .filter((name) => NAME.test(name))
        .map((name) => {
          const stat = fs.statSync(path.join(this.dir, name));
          return { name, bytes: stat.size, takenAt: stat.mtimeMs };
        })
        .sort((a, b) => b.takenAt - a.takenAt);
    } catch {
      return [];
    }
  }

  save(dataUrl: string, now = Date.now()): PhotoInfo {
    const match = DATA_URL.exec(dataUrl);
    if (!match) throw new Error('That is not a photo.');
    const buffer = Buffer.from(match[2], 'base64');
    if (buffer.length === 0 || buffer.length > MAX_PHOTO_BYTES)
      throw new Error('The photo is too large.');
    fs.mkdirSync(this.dir, { recursive: true });
    const name = `photo-${now}.${match[1] === 'png' ? 'png' : 'jpg'}`;
    fs.writeFileSync(path.join(this.dir, name), buffer);
    return { name, bytes: buffer.length, takenAt: now };
  }

  read(name: string): string {
    if (!NAME.test(name)) throw new Error('Unknown photo.');
    const buffer = fs.readFileSync(path.join(this.dir, name));
    return `data:image/${name.endsWith('.png') ? 'png' : 'jpeg'};base64,${buffer.toString('base64')}`;
  }

  remove(name: string): boolean {
    if (!NAME.test(name)) return false;
    try {
      fs.unlinkSync(path.join(this.dir, name));
      return true;
    } catch {
      return false;
    }
  }

  removeAll(): number {
    const all = this.list();
    for (const photo of all) this.remove(photo.name);
    return all.length;
  }
}
