import { describe, expect, it } from 'vitest';
import { fastReply } from '../src/main/llm/fastReply';
import { selectTools } from '../src/main/llm/toolSelect';

const NOW = new Date(2026, 10, 23, 14, 5);
describe('fastReply', () => {
  it('answers time, date and greetings locally', () => {
    expect(fastReply("what's the time", NOW)?.startsWith('It is ')).toBe(true);
    expect(fastReply('Jarvis, what time is it?', NOW)?.startsWith('It is ')).toBe(true);
    expect(fastReply("what's the date", NOW)?.includes('2026')).toBe(true);
    expect(fastReply('hello', NOW)).toBe('Hello. How can I help?');
    expect(fastReply('thanks', NOW)).toBe("You're welcome.");
  });
  it('leaves everything else to the model', () => {
    expect(fastReply('what time is my meeting tomorrow', NOW)).toBeNull();
    expect(fastReply('explain quantum computing', NOW)).toBeNull();
  });
});

describe('selectTools latency', () => {
  const all = ['search_memory', 'list_tasks', 'create_task', 'lab_run', 'calculate'].map(
    (name) => ({
      type: 'function' as const,
      function: { name, description: '', parameters: { type: 'object' as const, properties: {} } },
    }),
  );
  it('sends no tools for small talk', () => {
    expect(selectTools(all, 'tell me a fun fact about octopuses').length).toBe(0);
  });
  it('still sends tools for personal or task requests', () => {
    expect(selectTools(all, 'add a task to call mom').length > 0).toBe(true);
    expect(selectTools(all, 'what did I note yesterday').length > 0).toBe(true);
  });
});
