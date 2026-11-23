/**
 * Short pieces speak sooner: the first sound is ready after one small chunk, not a whole paragraph.
 * Breaks at sentence ends, then at commas or semicolons, then at spaces.
 */
export function chunkForSpeech(sentences: string[], maxChars = 90): string[] {
  const chunks: string[] = [];
  for (const sentence of sentences) {
    let rest = sentence.trim();
    while (rest.length > maxChars) {
      const window = rest.slice(0, maxChars);
      let cut = Math.max(
        window.lastIndexOf(', '),
        window.lastIndexOf('; '),
        window.lastIndexOf(': '),
      );
      if (cut < maxChars * 0.4) cut = window.lastIndexOf(' ');
      if (cut <= 0) cut = maxChars;
      chunks.push(rest.slice(0, cut + 1).trim());
      rest = rest.slice(cut + 1).trim();
    }
    if (rest) chunks.push(rest);
  }
  return chunks;
}
