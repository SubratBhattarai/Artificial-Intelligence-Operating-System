/** Input checks for IPC handlers: the renderer is untrusted, so every argument is validated. */

export function asString(value: unknown, name: string, maxLength = 10_000): string {
  if (typeof value !== 'string') throw new Error(`${name} must be text.`);
  if (value.length > maxLength) throw new Error(`${name} is too long.`);
  return value;
}

export function asId(value: unknown, name = 'id'): string {
  if (typeof value !== 'string' || !/^[\w:.-]{1,200}$/.test(value)) {
    throw new Error(`Invalid ${name}.`);
  }
  return value;
}

export function asObject(value: unknown, name: string): Record<string, unknown> {
  if (typeof value !== 'object' || value === null || Array.isArray(value)) {
    throw new Error(`${name} must be an object.`);
  }
  return value as Record<string, unknown>;
}

export function asOptionalNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined;
}
