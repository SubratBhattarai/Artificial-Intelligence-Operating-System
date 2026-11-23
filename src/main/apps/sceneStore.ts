import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { MAX_SCENES, sanitizeSteps, type Scene, type SceneStep } from '../../shared/scenes';
import { JsonFile } from '../store/jsonFile';

interface Data {
  version: 1;
  scenes: Scene[];
}

export class SceneStore {
  private readonly file: JsonFile<Data>;

  constructor(dataDir: string) {
    this.file = new JsonFile<Data>(
      path.join(dataDir, 'scenes.json'),
      () => ({ version: 1, scenes: [] }),
      (raw) => {
        const data = raw as Partial<Data> | null;
        if (!data || !Array.isArray(data.scenes)) return null;
        return {
          version: 1,
          scenes: data.scenes
            .filter(
              (s): s is Scene => !!s && typeof s.id === 'string' && typeof s.name === 'string',
            )
            .map((s) => ({ id: s.id, name: s.name.slice(0, 40), steps: sanitizeSteps(s.steps) })),
        };
      },
    );
  }

  list(): Scene[] {
    return this.file.value.scenes;
  }

  save(input: { id?: string; name: string; steps: unknown }): Scene {
    const name = input.name.trim().slice(0, 40);
    if (!name) throw new Error('A scene needs a name.');
    const steps: SceneStep[] = sanitizeSteps(input.steps);
    if (steps.length === 0) throw new Error('Add at least one valid step.');
    const scenes = this.file.value.scenes;
    const existing = input.id ? scenes.find((s) => s.id === input.id) : undefined;
    if (!existing && scenes.length >= MAX_SCENES)
      throw new Error(`You can keep up to ${MAX_SCENES} scenes.`);
    const scene: Scene = { id: existing?.id ?? randomUUID(), name, steps };
    this.file.set({
      version: 1,
      scenes: existing ? scenes.map((s) => (s.id === scene.id ? scene : s)) : [...scenes, scene],
    });
    return scene;
  }

  remove(id: string): boolean {
    const before = this.file.value.scenes.length;
    this.file.set({ version: 1, scenes: this.file.value.scenes.filter((s) => s.id !== id) });
    return this.file.value.scenes.length < before;
  }

  flush(): void {
    this.file.flushSync();
  }
}
