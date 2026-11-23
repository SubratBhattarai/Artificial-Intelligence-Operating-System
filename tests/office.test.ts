import { describe, expect, it } from 'vitest';
import { pptxSections, xlsxSections } from '../src/main/files/office';
import { compareTexts } from '../src/main/tools/compareDocuments';
import { classifyFile } from '../src/main/files/extract';

describe('office extraction and comparison', () => {
  it('reads shared strings, numbers and sheet names from xlsx xml', () => {
    const sections = xlsxSections({
      'xl/workbook.xml': '<sheets><sheet name="Budget" sheetId="1"/></sheets>',
      'xl/sharedStrings.xml': '<sst><si><t>Item</t></si><si><t>Rent &amp; bills</t></si></sst>',
      'xl/worksheets/sheet1.xml':
        '<sheetData><row r="1"><c r="A1" t="s"><v>0</v></c></row><row r="2"><c r="A2" t="s"><v>1</v></c><c r="B2"><v>950</v></c></row></sheetData>',
    });
    expect(sections).toEqual([{ label: 'Sheet: Budget', text: 'Item\nRent & bills\t950' }]);
  });

  it('reads slides in numeric order', () => {
    const slide = (text: string) => `<p:sp><a:p><a:r><a:t>${text}</a:t></a:r></a:p></p:sp>`;
    const sections = pptxSections({
      'ppt/slides/slide10.xml': slide('Ten'),
      'ppt/slides/slide2.xml': slide('Two'),
    });
    expect(sections.map((s) => s.text)).toEqual(['Two', 'Ten']);
  });

  it('classifies the new types and compares passages', () => {
    expect(classifyFile('XLSX')).toBe('xlsx');
    expect(classifyFile('pptx')).toBe('pptx');
    expect(classifyFile('png')).toBe('image');
    const result = compareTexts(
      'The rent is due monday. Pay the water bill.',
      'The rent is due monday. Call the landlord today.',
    );
    expect(result.shared).toBe(1);
    expect(result.onlyInFirst).toEqual(['Pay the water bill.']);
    expect(result.onlyInSecond).toEqual(['Call the landlord today.']);
  });
});
