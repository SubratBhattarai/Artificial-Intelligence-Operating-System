import { describe, expect, it } from 'vitest';
import { selectTools } from '../src/main/llm/toolSelect';

const names = [
  'search_memory',
  'read_document',
  'create_task',
  'set_volume',
  'run_command',
  'web_search',
  'start_agent',
  'create_file',
];
const all = names.map((name) => ({
  type: 'function' as const,
  function: { name, description: '', parameters: { type: 'object' as const, properties: {} } },
}));
const pick = (text: string) => selectTools(all as never, text).map((t) => t.function.name);

describe('per-turn tool selection', () => {
  it('sends no tools for plain chat, and the small core for personal questions', () => {
    expect(pick('hello there')).toEqual([]);
    expect(pick('what did I save about my thesis')).toEqual(['search_memory', 'read_document']);
  });
  it('adds only the matching tools', () => {
    expect(pick('turn the volume down')).toContain('set_volume');
    expect(pick('turn the volume down')).not.toContain('run_command');
    expect(pick('add a task to study')).toContain('create_task');
    expect(pick('search the web for news')).toContain('web_search');
  });
});
