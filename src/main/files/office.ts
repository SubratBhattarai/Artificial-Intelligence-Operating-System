/** Text from Excel (.xlsx) and PowerPoint (.pptx) files. They are zip files of XML; no macros are ever run. */

export interface OfficeSection {
  label: string;
  text: string;
}

const MAX_ROWS_PER_SHEET = 2000;

function unescapeXml(value: string): string {
  return value
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&apos;/g, "'")
    .replace(/&#(\d+);/g, (_m, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&amp;/g, '&');
}

function textRuns(xml: string, tag: string): string {
  const pattern = new RegExp(`<${tag}(?:\\s[^>]*)?>([\\s\\S]*?)</${tag}>`, 'g');
  return [...xml.matchAll(pattern)].map((m) => unescapeXml(m[1])).join('');
}

function numericOrder(a: string, b: string): number {
  const num = (s: string) => Number(s.match(/(\d+)\.xml$/)?.[1] ?? 0);
  return num(a) - num(b);
}

export function xlsxSections(files: Record<string, string>): OfficeSection[] {
  const shared = [...(files['xl/sharedStrings.xml'] ?? '').matchAll(/<si[\s>][\s\S]*?<\/si>/g)].map(
    (m) => textRuns(m[0], 't'),
  );
  const names = [...(files['xl/workbook.xml'] ?? '').matchAll(/<sheet\s[^>]*name="([^"]*)"/g)].map(
    (m) => unescapeXml(m[1]),
  );
  const sheetPaths = Object.keys(files)
    .filter((name) => /^xl\/worksheets\/sheet\d+\.xml$/.test(name))
    .sort(numericOrder);
  return sheetPaths.flatMap((sheetPath, index) => {
    const rows: string[] = [];
    for (const row of files[sheetPath].matchAll(/<row[\s>][\s\S]*?<\/row>/g)) {
      const cells: string[] = [];
      for (const cell of row[0].matchAll(/<c\s([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g)) {
        const type = cell[1].match(/\bt="(\w+)"/)?.[1];
        const body = cell[2] ?? '';
        let value = '';
        if (type === 's') value = shared[Number(body.match(/<v>(\d+)<\/v>/)?.[1])] ?? '';
        else if (type === 'inlineStr') value = textRuns(body, 't');
        else value = unescapeXml(body.match(/<v>([\s\S]*?)<\/v>/)?.[1] ?? '');
        cells.push(value);
      }
      if (cells.some((c) => c !== '')) rows.push(cells.join('\t'));
      if (rows.length >= MAX_ROWS_PER_SHEET) break;
    }
    return rows.length === 0
      ? []
      : [{ label: `Sheet: ${names[index] ?? `${index + 1}`}`, text: rows.join('\n') }];
  });
}

export function pptxSections(files: Record<string, string>): OfficeSection[] {
  return Object.keys(files)
    .filter((name) => /^ppt\/slides\/slide\d+\.xml$/.test(name))
    .sort(numericOrder)
    .flatMap((slidePath, index) => {
      const paragraphs = [...files[slidePath].matchAll(/<a:p[\s>][\s\S]*?<\/a:p>/g)]
        .map((m) => textRuns(m[0], 'a:t').trim())
        .filter(Boolean);
      return paragraphs.length === 0
        ? []
        : [{ label: `Slide ${index + 1}`, text: paragraphs.join('\n') }];
    });
}

interface ZipLike {
  files: Record<string, { dir: boolean; async(type: 'string'): Promise<string> }>;
}
interface JsZipStatic {
  loadAsync(data: Buffer): Promise<ZipLike>;
}

/** Read only the XML parts we need from the zip (capped), then parse. */
export async function officeSectionsFromBuffer(
  buffer: Buffer,
  kind: 'xlsx' | 'pptx',
): Promise<{ ok: true; sections: OfficeSection[] } | { ok: false; reason: string }> {
  let JSZip: JsZipStatic;
  try {
    // Loaded lazily so the app still runs before `npm install` adds it.
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    JSZip = require('jszip') as JsZipStatic;
  } catch {
    return {
      ok: false,
      reason: 'Office support is not installed — run "npm install" to add jszip.',
    };
  }
  try {
    const zip = await JSZip.loadAsync(buffer);
    const wanted = Object.keys(zip.files).filter((name) =>
      kind === 'xlsx'
        ? /^xl\/(worksheets\/sheet\d+|sharedStrings|workbook)\.xml$/.test(name)
        : /^ppt\/slides\/slide\d+\.xml$/.test(name),
    );
    if (wanted.length > 400)
      return { ok: false, reason: 'the file has too many parts to read safely' };
    const files: Record<string, string> = {};
    let total = 0;
    for (const name of wanted) {
      const xml = await zip.files[name].async('string');
      total += xml.length;
      if (total > 60 * 1024 * 1024)
        return { ok: false, reason: 'the file expands too large to read safely' };
      files[name] = xml;
    }
    const sections = kind === 'xlsx' ? xlsxSections(files) : pptxSections(files);
    return sections.length === 0
      ? { ok: false, reason: 'the file has no readable text' }
      : { ok: true, sections };
  } catch (error) {
    return {
      ok: false,
      reason: `the file could not be parsed (${error instanceof Error ? error.message : String(error)})`,
    };
  }
}
