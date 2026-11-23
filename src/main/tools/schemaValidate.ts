import { isDateString } from '../../shared/apps';
import type { JsonSchemaObject } from './types';

export type ValidationResult =
  { ok: true; value: Record<string, unknown> } | { ok: false; errors: string[] };

interface PropertySchema {
  type?: string;
  enum?: unknown[];
  minLength?: number;
  maxLength?: number;
  minimum?: number;
  maximum?: number;
  pattern?: string;
  format?: string;
}

function checkValue(name: string, value: unknown, schema: PropertySchema): string[] {
  const errors: string[] = [];
  switch (schema.type) {
    case 'string': {
      if (typeof value !== 'string') return [`${name} must be text`];
      if (schema.minLength !== undefined && value.length < schema.minLength) {
        errors.push(`${name} must be at least ${schema.minLength} characters`);
      }
      if (schema.maxLength !== undefined && value.length > schema.maxLength) {
        errors.push(`${name} must be at most ${schema.maxLength} characters`);
      }
      if (schema.pattern && !new RegExp(schema.pattern).test(value)) {
        errors.push(`${name} has the wrong format`);
      }
      if (schema.format === 'date' && !isDateString(value)) {
        errors.push(`${name} must be a date like 2026-12-31`);
      }
      if (schema.format === 'date-time' && Number.isNaN(Date.parse(value))) {
        errors.push(`${name} must be a date and time like 2026-12-31T14:30`);
      }
      break;
    }
    case 'number':
    case 'integer': {
      if (typeof value !== 'number' || !Number.isFinite(value)) return [`${name} must be a number`];
      if (schema.type === 'integer' && !Number.isInteger(value)) {
        errors.push(`${name} must be a whole number`);
      }
      if (schema.minimum !== undefined && value < schema.minimum) {
        errors.push(`${name} must be at least ${schema.minimum}`);
      }
      if (schema.maximum !== undefined && value > schema.maximum) {
        errors.push(`${name} must be at most ${schema.maximum}`);
      }
      break;
    }
    case 'boolean':
      if (typeof value !== 'boolean') return [`${name} must be true or false`];
      break;
    default:
      break;
  }
  if (schema.enum && !schema.enum.includes(value)) {
    errors.push(`${name} must be one of: ${schema.enum.join(', ')}`);
  }
  return errors;
}

/**
 * Deterministic argument validation against the tool's own schema (a strict JSON-schema subset:
 * type, required, enum, length/range limits, pattern, date formats, no unknown keys).
 */
export function validateArgs(schema: JsonSchemaObject, args: unknown): ValidationResult {
  if (typeof args !== 'object' || args === null || Array.isArray(args)) {
    return { ok: false, errors: ['arguments must be an object'] };
  }
  const input = args as Record<string, unknown>;
  const errors: string[] = [];
  for (const key of schema.required ?? []) {
    if (input[key] === undefined || input[key] === null) errors.push(`${key} is required`);
  }
  for (const [key, value] of Object.entries(input)) {
    const property = schema.properties[key] as PropertySchema | undefined;
    if (!property) {
      if (schema.additionalProperties === false) errors.push(`${key} is not a known argument`);
      continue;
    }
    if (value === undefined || value === null) continue;
    errors.push(...checkValue(key, value, property));
  }
  return errors.length > 0 ? { ok: false, errors } : { ok: true, value: input };
}
