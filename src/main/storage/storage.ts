import fs from 'node:fs';
import path from 'node:path';

/** Pure file-system helpers for measuring and cleaning AI OS's own storage. Nothing outside its folders is touched. */

export async function pathSize(target: string): Promise<number> {
  let stat: fs.Stats;
  try {
    stat = await fs.promises.lstat(target);
  } catch {
    return 0;
  }
  if (stat.isSymbolicLink()) return 0;
  if (!stat.isDirectory()) return stat.size;
  let total = 0;
  let entries: string[] = [];
  try {
    entries = await fs.promises.readdir(target);
  } catch {
    return 0;
  }
  const sizes = await Promise.all(entries.map((name) => pathSize(path.join(target, name))));
  for (const size of sizes) total += size;
  return total;
}

export async function removePath(target: string): Promise<void> {
  await fs.promises.rm(target, { recursive: true, force: true });
}

/** Temp and quarantined files left behind in the data folder. */
export async function findLeftovers(dataDir: string): Promise<string[]> {
  try {
    const names = await fs.promises.readdir(dataDir);
    return names
      .filter((name) => name.endsWith('.tmp') || /\.corrupt-\d+$/.test(name))
      .map((name) => path.join(dataDir, name));
  } catch {
    return [];
  }
}

/** Chromium caches that are rebuilt on demand. */
export const CACHE_FOLDERS = ['Cache', 'Code Cache', 'GPUCache', 'DawnCache', 'GrShaderCache'];

export function cacheFolders(userDataDir: string): string[] {
  return CACHE_FOLDERS.map((name) => path.join(userDataDir, name));
}

/** Downloaded speech models other than the one in use (`org/name` folders under the cache). */
export async function findUnusedModels(modelsDir: string, activeModel: string): Promise<string[]> {
  const found: string[] = [];
  let orgs: string[] = [];
  try {
    orgs = await fs.promises.readdir(modelsDir);
  } catch {
    return found;
  }
  const active = path.normalize(path.join(modelsDir, ...activeModel.split('/')));
  for (const org of orgs) {
    const orgPath = path.join(modelsDir, org);
    let names: string[] = [];
    try {
      names = await fs.promises.readdir(orgPath);
    } catch {
      continue;
    }
    for (const name of names) {
      const candidate = path.normalize(path.join(orgPath, name));
      if (candidate !== active) found.push(candidate);
    }
  }
  return found;
}

export async function sizeOfAll(paths: string[]): Promise<number> {
  const sizes = await Promise.all(paths.map(pathSize));
  return sizes.reduce((sum, size) => sum + size, 0);
}

/** Size of each top-level JSON data file, largest first. */
export async function dataFileSizes(
  dataDir: string,
): Promise<Array<{ name: string; bytes: number }>> {
  try {
    const names = (await fs.promises.readdir(dataDir)).filter((name) => name.endsWith('.json'));
    const sized = await Promise.all(
      names.map(async (name) => ({ name, bytes: await pathSize(path.join(dataDir, name)) })),
    );
    return sized.sort((a, b) => b.bytes - a.bytes);
  } catch {
    return [];
  }
}
