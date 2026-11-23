import path from 'node:path';
import { JsonFile } from '../store/jsonFile';

interface ToolSettingsData {
  version: 1;
  disabled: string[];
}

/** Which tools the user has switched off. Everything is on by default; changes always need approval. */
export class ToolSettings {
  private readonly file: JsonFile<ToolSettingsData>;

  constructor(dataDir: string) {
    this.file = new JsonFile<ToolSettingsData>(
      path.join(dataDir, 'tool-settings.json'),
      () => ({ version: 1, disabled: [] }),
      (raw) => {
        const data = raw as Partial<ToolSettingsData> | null;
        if (!data || !Array.isArray(data.disabled)) return null;
        return {
          version: 1,
          disabled: data.disabled.filter((name): name is string => typeof name === 'string'),
        };
      },
    );
  }

  isEnabled = (name: string): boolean => !this.file.value.disabled.includes(name);

  setEnabled(name: string, enabled: boolean): void {
    const disabled = new Set(this.file.value.disabled);
    if (enabled) disabled.delete(name);
    else disabled.add(name);
    this.file.set({ version: 1, disabled: [...disabled] });
  }

  flush(): void {
    this.file.flushSync();
  }
}
