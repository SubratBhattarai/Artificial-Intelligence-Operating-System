import { config as loadEnv } from 'dotenv';
import path from 'node:path';

// Secrets live only in .env (gitignored) and are read exclusively in the main process.
// The renderer never sees these values — only sanitized booleans/names cross the IPC bridge.
loadEnv({ path: path.join(process.cwd(), '.env') });

export type ProviderChoice = 'ollama' | 'openai';

function readProvider(): ProviderChoice {
  const raw = (process.env.AIOS_PROVIDER ?? 'ollama').toLowerCase().trim();
  return raw === 'openai' ? 'openai' : 'ollama';
}

export const config = {
  provider: readProvider(),
  ollama: {
    baseUrl: (process.env.OLLAMA_BASE_URL ?? 'http://127.0.0.1:11434').replace(/\/$/, ''),
    model: process.env.OLLAMA_MODEL ?? 'llama3.2',
  },
  openai: {
    baseUrl: (process.env.OPENAI_BASE_URL ?? 'https://api.openai.com/v1').replace(/\/$/, ''),
    apiKey: process.env.OPENAI_API_KEY ?? '',
    model: process.env.OPENAI_MODEL ?? 'gpt-4o-mini',
  },
  /** Speech-to-text runs fully on this machine (Whisper via transformers.js). No API, no key. */
  stt: {
    model: process.env.AIOS_STT_MODEL ?? '',
    language: process.env.AIOS_STT_LANGUAGE ?? '',
  },
  /** Extra folders the Files app / list_folder tool may read, `;`-separated. Empty = sensible defaults. */
  allowedFolders: (process.env.AIOS_ALLOWED_FOLDERS ?? '')
    .split(';')
    .map((entry) => entry.trim())
    .filter(Boolean),
  /** Global summon shortcut for the JARVIS overlay. */
  summonShortcut: process.env.AIOS_SUMMON_SHORTCUT ?? 'Alt+Space',
  /** Maximum tool-use rounds per user message. */
  toolRounds: 4,
};
