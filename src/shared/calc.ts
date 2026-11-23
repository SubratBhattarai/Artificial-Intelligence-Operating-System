/**
 * A small, safe arithmetic evaluator (no eval, no Function): recursive descent over a fixed
 * grammar. Used by the Calculator app and the `calculate` tool.
 */

const CONSTANTS: Record<string, number> = { pi: Math.PI, e: Math.E, tau: Math.PI * 2 };
const FUNCTIONS: Record<string, (...args: number[]) => number> = {
  sqrt: Math.sqrt,
  cbrt: Math.cbrt,
  abs: Math.abs,
  ln: Math.log,
  log: Math.log10,
  log2: Math.log2,
  exp: Math.exp,
  sin: Math.sin,
  cos: Math.cos,
  tan: Math.tan,
  asin: Math.asin,
  acos: Math.acos,
  atan: Math.atan,
  floor: Math.floor,
  ceil: Math.ceil,
  round: Math.round,
  min: Math.min,
  max: Math.max,
  pow: Math.pow,
};
const MAX_LENGTH = 200;
const MAX_DEPTH = 40;

type Token =
  { kind: 'num'; value: number } | { kind: 'id'; value: string } | { kind: 'op'; value: string };

function tokenize(input: string): Token[] {
  const tokens: Token[] = [];
  let index = 0;
  while (index < input.length) {
    const char = input[index];
    if (/\s/.test(char)) {
      index += 1;
      continue;
    }
    const number = /^(?:\d+\.?\d*|\.\d+)(?:e[+-]?\d+)?/i.exec(input.slice(index));
    if (number) {
      tokens.push({ kind: 'num', value: Number(number[0]) });
      index += number[0].length;
      continue;
    }
    const id = /^[a-z][a-z0-9]*/i.exec(input.slice(index));
    if (id) {
      tokens.push({ kind: 'id', value: id[0].toLowerCase() });
      index += id[0].length;
      continue;
    }
    if ('+-*/^%(),×÷−'.includes(char)) {
      const op = char === '×' ? '*' : char === '÷' ? '/' : char === '−' ? '-' : char;
      tokens.push({ kind: 'op', value: op });
      index += 1;
      continue;
    }
    throw new Error(`Unexpected "${char}".`);
  }
  return tokens;
}

export function evaluateExpression(input: string): number {
  if (input.length > MAX_LENGTH) throw new Error('That expression is too long.');
  const tokens = tokenize(input);
  if (tokens.length === 0) throw new Error('Enter an expression.');
  let position = 0;

  const peek = () => tokens[position];
  const take = () => tokens[position++];
  const isOp = (value: string) => {
    const token = peek();
    return token?.kind === 'op' && token.value === value;
  };

  function parseExpression(depth: number): number {
    if (depth > MAX_DEPTH) throw new Error('That expression is nested too deeply.');
    let value = parseTerm(depth);
    while (isOp('+') || isOp('-')) {
      const op = (take() as { value: string }).value;
      const right = parseTerm(depth);
      value = op === '+' ? value + right : value - right;
    }
    return value;
  }

  function parseTerm(depth: number): number {
    let value = parseUnary(depth);
    while (isOp('*') || isOp('/') || isOp('%')) {
      const op = (take() as { value: string }).value;
      const right = parseUnary(depth);
      if (op === '*') value *= right;
      else if (right === 0) throw new Error('Cannot divide by zero.');
      else value = op === '/' ? value / right : value % right;
    }
    return value;
  }

  function parseUnary(depth: number): number {
    if (isOp('-')) {
      take();
      return -parseUnary(depth);
    }
    if (isOp('+')) {
      take();
      return parseUnary(depth);
    }
    return parsePower(depth);
  }

  function parsePower(depth: number): number {
    const base = parsePrimary(depth);
    if (isOp('^')) {
      take();
      return Math.pow(base, parseUnary(depth)); // right-associative
    }
    return base;
  }

  function parsePrimary(depth: number): number {
    const token = take();
    if (!token) throw new Error('The expression ends too early.');
    if (token.kind === 'num') return token.value;
    if (token.kind === 'op' && token.value === '(') {
      const value = parseExpression(depth + 1);
      if (!isOp(')')) throw new Error('Missing a closing parenthesis.');
      take();
      return value;
    }
    if (token.kind === 'id') {
      if (isOp('(')) {
        const fn = FUNCTIONS[token.value];
        if (!fn) throw new Error(`Unknown function "${token.value}".`);
        take();
        const args: number[] = [];
        if (!isOp(')')) {
          args.push(parseExpression(depth + 1));
          while (isOp(',')) {
            take();
            args.push(parseExpression(depth + 1));
          }
        }
        if (!isOp(')')) throw new Error('Missing a closing parenthesis.');
        take();
        return fn(...args);
      }
      if (token.value in CONSTANTS) return CONSTANTS[token.value];
      throw new Error(`Unknown name "${token.value}".`);
    }
    throw new Error(`Unexpected "${token.value}".`);
  }

  const result = parseExpression(0);
  if (position < tokens.length) throw new Error('Unexpected input after the expression.');
  if (!Number.isFinite(result)) throw new Error('The result is not a finite number.');
  return result;
}

/** Trim floating-point noise (0.1 + 0.2 → 0.3) for display. */
export function formatResult(value: number): string {
  if (Number.isInteger(value) && Math.abs(value) < 1e15) return String(value);
  return String(Number(value.toPrecision(12)));
}
