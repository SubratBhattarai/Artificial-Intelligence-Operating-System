import { useMemo } from 'react';
import { queryTerms, splitHighlight } from '../../shared/text';

/** Text with the query's words wrapped in <mark>. */
export function Highlight({ text, query }: { text: string; query: string }) {
  const parts = useMemo(() => splitHighlight(text, queryTerms(query)), [text, query]);
  return (
    <>
      {parts.map((part, index) =>
        part.hit ? <mark key={index}>{part.text}</mark> : <span key={index}>{part.text}</span>,
      )}
    </>
  );
}
