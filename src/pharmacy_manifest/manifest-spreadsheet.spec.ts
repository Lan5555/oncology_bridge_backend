import { Workbook, CellValue } from 'exceljs';
import { ManifestSpreadsheetService } from './manifest-spreadsheet.service';
import { inspectManifest, ManifestBodyPipe } from './manifest-validation';
import { BadRequestException } from '@nestjs/common';

const service = new ManifestSpreadsheetService();
const headers = [
  'Barcode (GTIN)',
  'Batch number',
  'Serial number',
  'Expiry date',
];
const pack = ['00012345600012', 'Batch-a', 'Serial-a', '2028-02-29'];
const csv = (text: string) =>
  service.parse({ originalname: 'delivery.csv', buffer: Buffer.from(text) });
async function xlsx(
  rows: CellValue[][],
  date1904 = false,
  customize?: (book: Workbook) => void,
) {
  const book = new Workbook();
  book.properties.date1904 = date1904;
  const sheet = book.addWorksheet('Delivery');
  rows.forEach((row) => sheet.addRow(row));
  customize?.(book);
  return {
    originalname: 'delivery.xlsx',
    buffer: Buffer.from(await book.xlsx.writeBuffer()),
  };
}
function review(parsed: Awaited<ReturnType<typeof service.parse>>) {
  return [
    ...parsed.issues,
    ...inspectManifest(
      { reference: 'REF', packs: parsed.packs },
      parsed.rowNumbers,
    ).issues,
  ];
}

describe('delivery spreadsheets', () => {
  it.each([
    [1, '1900-01-01'],
    [59, '1900-02-28'],
    [61, '1900-03-01'],
  ])(
    'interprets early Excel date serial %s correctly',
    async (serial, date) => {
      const file = await xlsx(
        [headers, [...pack.slice(0, 3), Number(serial)]],
        false,
        (book) => {
          book.worksheets[0].getCell('D2').numFmt = 'yyyy-mm-dd';
        },
      );
      expect((await service.parse(file)).packs[0].expiry).toBe(date);
    },
  );
  it('rejects Excel serial 60 rather than accepting the nonexistent 1900 leap day', async () => {
    const file = await xlsx(
      [headers, [...pack.slice(0, 3), 60]],
      false,
      (book) => {
        book.worksheets[0].getCell('D2').numFmt = 'yyyy-mm-dd';
      },
    );
    expect(review(await service.parse(file))).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, code: 'INVALID_EXPIRY' }),
      ]),
    );
  });
  it.each(['xlsx', 'csv'])(
    'downloads a blank %s template with instructions and four headers',
    async (format) => {
      const file = await service.template(format);
      expect(file.filename).toBe(`pharmacy-delivery-template.${format}`);
      const parsed = await service.parse({
        originalname: file.filename,
        buffer: file.buffer,
      });
      expect(parsed.totalRows).toBe(0);
      expect(parsed.issues).toEqual([]);
      if (format === 'xlsx') {
        const book = new Workbook();
        await book.xlsx.load(file.buffer as never);
        expect(book.worksheets).toHaveLength(1);
        expect(book.worksheets[0].actualRowCount).toBe(1);
        expect(book.worksheets[0].getColumn(1).numFmt).toBe('@');
        expect(book.worksheets[0].getColumn(2).numFmt).toBe('@');
        expect(book.worksheets[0].getColumn(3).numFmt).toBe('@');
        expect(book.worksheets[0].getCell('A1').note).toBeDefined();
      } else
        expect(file.buffer.toString('utf8')).toContain(
          'one row per individual pack/vial',
        );
    },
  );
  it('preserves zeros, case, blanks and actual CSV row numbers', async () => {
    const parsed = await csv(
      `\uFEFF${headers.join(',')}\r\n\r\n${pack.join(',')}\r\n`,
    );
    expect(parsed.rowNumbers).toEqual([3]);
    expect(parsed.packs).toEqual([
      { gtin: pack[0], lot: pack[1], serial: pack[2], expiry: pack[3] },
    ]);
    expect(review(parsed)).toEqual([]);
  });
  it('maps mixed headers case-insensitively in any order', async () => {
    const parsed = await csv(
      'SERIAL,Expiry DATE,gtin,BATCH NUMBER\nSerial-a,2028-02-29,00012345600012,Batch-a',
    );
    expect(review(parsed)).toEqual([]);
    expect(parsed.packs[0].serial).toBe('Serial-a');
  });
  it.each([
    ['gtin,lot,serial', 'COLUMN_REQUIRED'],
    ['gtin,lot,serial,expiry,Serial number', 'COLUMN_AMBIGUOUS'],
    ['gtin,lot,serial,expiry,quantity', 'COLUMN_UNEXPECTED'],
  ])('rejects invalid columns %s', async (head, code) => {
    expect((await csv(head)).issues).toEqual(
      expect.arrayContaining([expect.objectContaining({ code })]),
    );
  });
  it.each([false, true])(
    'uses the workbook date system (1904 = %s)',
    async (date1904) => {
      const file = await xlsx(
        [headers, [...pack.slice(0, 3), new Date('2028-02-29T00:00:00Z')]],
        date1904,
        (book) => {
          book.worksheets[0].getCell('D2').numFmt = 'yyyy-mm-dd';
        },
      );
      const parsed = await service.parse(file);
      expect(parsed.packs[0].expiry).toBe('2028-02-29');
      expect(review(parsed)).toEqual([]);
    },
  );
  it.each([
    12345600012,
    { formula: '"00012345600012"', result: '00012345600012' },
  ])(
    'rejects numeric/formula identifiers even with cached values or text formatting',
    async (value) => {
      const file = await xlsx(
        [headers, [value, ...pack.slice(1)]],
        false,
        (book) => {
          book.worksheets[0].getCell('A2').numFmt = '@';
        },
      );
      const parsed = await service.parse(file);
      expect(parsed.issues).toEqual(
        expect.arrayContaining([
          expect.objectContaining({
            field: 'gtin',
            code:
              typeof value === 'number'
                ? 'IDENTIFIER_MUST_BE_TEXT'
                : 'FORMULA_NOT_ALLOWED',
          }),
        ]),
      );
    },
  );
  it('rejects scientific notation from CSV, formulas and ambiguous dates', async () => {
    const parsed = await csv(
      'gtin,lot,serial,expiry\n1.23456E+10,B1,=A1,03/04/27',
    );
    expect(parsed.issues.map((entry) => entry.code)).toEqual(
      expect.arrayContaining([
        'IDENTIFIER_MUST_BE_TEXT',
        'FORMULA_NOT_ALLOWED',
        'INVALID_EXPIRY',
      ]),
    );
  });
  it.each(['2027-02-29', '2028-02-30', '2027-04-31', '0000-01-01'])(
    'rejects impossible ISO date %s',
    async (expiry) => {
      const parsed = await csv(
        `gtin,lot,serial,expiry\n00012345600012,B1,S1,${expiry}`,
      );
      expect(review(parsed)).toEqual(
        expect.arrayContaining([
          expect.objectContaining({ row: 2, code: 'INVALID_EXPIRY' }),
        ]),
      );
    },
  );
  it('reports missing serial, bad check digit and every duplicate row', async () => {
    const parsed = await csv(
      'gtin,lot,serial,expiry\n00012345600012,B1,,2028-02-29\n00012345600013,B1,S1,2028-02-29\n00012345600012,B1,S2,2028-02-29\n00012345600012,B1,S2,2028-02-29',
    );
    const issues = review(parsed);
    expect(issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ row: 2, code: 'SERIAL_REQUIRED' }),
        expect.objectContaining({ row: 3, code: 'INVALID_GTIN' }),
        expect.objectContaining({ row: 4, code: 'DUPLICATE_PACK_IN_FILE' }),
        expect.objectContaining({ row: 5, code: 'DUPLICATE_PACK_IN_FILE' }),
      ]),
    );
  });
  it('rejects multiple nonempty sheets, including hidden sheets', async () => {
    const file = await xlsx([headers, pack], false, (book) => {
      book.addWorksheet('Other', { state: 'hidden' }).addRow(['data']);
    });
    await expect(service.parse(file)).rejects.toThrow('more than one nonempty');
  });
  it('ignores a completely empty sheet', async () => {
    const file = await xlsx([headers, pack], false, (book) => {
      book.addWorksheet('Empty');
    });
    expect(review(await service.parse(file))).toEqual([]);
  });
  it('reports a readable 1001-row delivery without returning more than 1000 pack rows', async () => {
    const parsed = await csv(
      'gtin,lot,serial,expiry\n' +
        Array.from(
          { length: 1001 },
          (_, i) => `00012345600012,B1,S${i},2028-02-29`,
        ).join('\n'),
    );
    expect(parsed.totalRows).toBe(1001);
    expect(parsed.packs).toHaveLength(1000);
    expect(parsed.issues).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'ROW_LIMIT_EXCEEDED' }),
      ]),
    );
  });
  it('rejects unsupported, oversized and malformed files', async () => {
    await expect(
      service.parse({ originalname: 'file.xls', buffer: Buffer.from('file') }),
    ).rejects.toMatchObject({ status: 415 });
    await expect(
      service.parse({
        originalname: 'file.xlsx',
        buffer: Buffer.alloc(5 * 1024 * 1024 + 1),
      }),
    ).rejects.toMatchObject({ status: 413 });
    await expect(
      service.parse({
        originalname: 'file.xlsx',
        buffer: Buffer.from('broken'),
      }),
    ).rejects.toMatchObject({ status: 400 });
    await expect(
      csv('gtin,lot,serial,expiry\n"unclosed'),
    ).rejects.toMatchObject({ status: 400 });
  });
  it('bounds expansion, sparse coordinates and cell count before workbook loading', async () => {
    const inflated = await xlsx([headers, pack]);
    const central = inflated.buffer.indexOf(
      Buffer.from([0x50, 0x4b, 0x01, 0x02]),
    );
    inflated.buffer.writeUInt32LE(9 * 1024 * 1024, central + 24);
    await expect(service.parse(inflated)).rejects.toThrow('too complex');
    const sparse = await xlsx([headers], false, (book) => {
      book.worksheets[0].getCell('A10001').value = 'value';
    });
    await expect(service.parse(sparse)).rejects.toThrow('too complex');
    const dense = await xlsx(Array.from({ length: 3001 }, () => pack));
    await expect(service.parse(dense)).rejects.toThrow('too complex');
  });
  it('handles quoted CSV correctly and never silently trims identifiers', async () => {
    const parsed = await csv(
      'gtin,lot,serial,expiry\n"00012345600012","Batch-a"," Serial-a",2028-02-29',
    );
    expect(parsed.packs[0].serial).toBe(' Serial-a');
    expect(review(parsed)).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ code: 'SERIAL_REQUIRED' }),
      ]),
    );
  });
  it('uses the same issue shape for manual pack cards', () => {
    let caught: unknown;
    try {
      new ManifestBodyPipe().transform({
        reference: 'REF',
        packs: [{ gtin: pack[0], lot: 'B1', serial: '', expiry: '2028-02-29' }],
      });
    } catch (error) {
      caught = error;
    }
    expect(caught).toBeInstanceOf(BadRequestException);
    expect((caught as BadRequestException).getResponse()).toMatchObject({
      data: { issues: [{ row: 1, field: 'serial', code: 'SERIAL_REQUIRED' }] },
    });
  });
});
