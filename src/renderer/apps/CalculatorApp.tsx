import { useCallback, useEffect, useState } from 'react';
import type { ReactElement } from 'react';
import { evaluateExpression, formatResult } from '../../shared/calc';

const KEYS = [
  'C',
  '(',
  ')',
  '/',
  '7',
  '8',
  '9',
  '*',
  '4',
  '5',
  '6',
  '-',
  '1',
  '2',
  '3',
  '+',
  '0',
  '.',
  '⌫',
  '=',
];

export function CalculatorApp(): ReactElement {
  const [expression, setExpression] = useState('');
  const [result, setResult] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [history, setHistory] = useState<Array<{ expression: string; result: string }>>([]);

  const press = useCallback(
    (key: string) => {
      setError(null);
      if (key === 'C') {
        setExpression('');
        setResult(null);
        return;
      }
      if (key === '⌫') {
        setExpression((value) => value.slice(0, -1));
        return;
      }
      if (key === '=') {
        if (!expression.trim()) return;
        try {
          const text = formatResult(evaluateExpression(expression));
          setResult(text);
          setHistory((items) => [{ expression, result: text }, ...items].slice(0, 20));
          setExpression(text);
        } catch (err) {
          setError(err instanceof Error ? err.message : 'Cannot calculate that.');
        }
        return;
      }
      setExpression((value) => (result !== null && /[0-9.]/.test(key) ? key : value + key));
      setResult(null);
    },
    [expression, result],
  );

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      const target = event.target as HTMLElement | null;
      if (!target?.closest('.calc')) return;
      if (/^[0-9+\-*/().]$/.test(event.key)) press(event.key);
      else if (event.key === 'Enter') press('=');
      else if (event.key === 'Backspace') press('⌫');
      else if (event.key === 'Escape') press('C');
      else return;
      event.preventDefault();
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [press]);

  return (
    <div className="calc" tabIndex={0}>
      <div className="calc-display" aria-live="polite">
        <div className="calc-expr">{expression || '0'}</div>
        {error && <div className="calc-error">{error}</div>}
      </div>
      <div className="calc-keys">
        {KEYS.map((key) => (
          <button
            key={key}
            type="button"
            className={`calc-key ${/[0-9.]/.test(key) ? '' : key === '=' ? 'primary' : 'op'}`}
            onClick={() => press(key)}
          >
            {key}
          </button>
        ))}
      </div>
      {history.length > 0 && (
        <ul className="calc-history">
          {history.map((item, index) => (
            <li key={`${item.expression}-${index}`}>
              <span>{item.expression}</span> = <strong>{item.result}</strong>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
