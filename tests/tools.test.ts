import { describe, expect, it } from 'vitest';
import { ToolRegistry } from '../src/main/tools/registry';
import type { Tool } from '../src/main/tools/types';

const echoTool: Tool<{ value?: string }, { echo: string }> = {
  name: 'echo_tool',
  description: 'Echoes a value back (test fixture).',
  parameters: {
    type: 'object',
    properties: { value: { type: 'string' } },
    required: [],
  },
  async execute(params) {
    return { echo: params.value ?? '' };
  },
};

const failingTool: Tool<Record<string, never>, never> = {
  name: 'failing_tool',
  description: 'Always throws (test fixture).',
  parameters: { type: 'object', properties: {}, required: [] },
  async execute() {
    throw new Error('boom');
  },
};

describe('ToolRegistry', () => {
  it('registers tools and exposes provider schemas', () => {
    const registry = new ToolRegistry().register(echoTool);
    const schemas = registry.schemas();
    expect(schemas).toHaveLength(1);
    expect(schemas[0].type).toBe('function');
    expect(schemas[0].function.name).toBe('echo_tool');
    expect(schemas[0].function.parameters.type).toBe('object');
  });

  it('rejects duplicate and malformed tool names', () => {
    const registry = new ToolRegistry().register(echoTool);
    expect(() => registry.register(echoTool)).toThrow(/already registered/);
    expect(() => registry.register({ ...echoTool, name: 'Bad Name!' })).toThrow(
      /Invalid tool name/,
    );
  });

  it('executes tools with stringified JSON arguments', async () => {
    const registry = new ToolRegistry().register(echoTool);
    const result = await registry.run('echo_tool', '{"value":"hi"}');
    expect(result.ok).toBe(true);
    const payload = JSON.parse(result.output);
    expect(payload.status).toBe('completed');
    expect(payload.result).toEqual({ echo: 'hi' });
  });

  it('returns ok:false for unknown tools instead of throwing', async () => {
    const registry = new ToolRegistry();
    const result = await registry.run('nope', {});
    expect(result.ok).toBe(false);
    expect(result.output).toContain('unknown_tool');
  });

  it('returns ok:false for malformed arguments and tool failures', async () => {
    const registry = new ToolRegistry().register(echoTool).register(failingTool);
    expect((await registry.run('echo_tool', 'not json')).ok).toBe(false);
    expect((await registry.run('echo_tool', [1, 2])).ok).toBe(false);
    const failed = await registry.run('failing_tool', {});
    expect(failed.ok).toBe(false);
    expect(failed.output).toContain('boom');
  });
});
