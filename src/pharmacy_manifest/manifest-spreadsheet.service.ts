import {
  BadRequestException,
  Injectable,
  PayloadTooLargeException,
  UnsupportedMediaTypeException,
} from '@nestjs/common';
import { Workbook, CellValue } from 'exceljs';
import { TextDecoder } from 'node:util';
import { extname } from 'node:path';
import { checkXlsxArchive } from './xlsx-limits';
import { issue, ManifestIssue } from './manifest-validation';

const headers = [
  'Barcode (GTIN)',
  'Batch number',
  'Serial number',
  'Expiry date',
];
const fields = ['gtin', 'lot', 'serial', 'expiry'] as const;
const instructions =
  'Enter one row per individual pack/vial. Preserve leading zeros and letter case. Enter identifiers as text; a quantity cannot replace serial numbers. Use YYYY-MM-DD dates. Enter the delivery reference separately in the app.';
type SheetRow = { row: number; cells: unknown[] };
export interface DeliveryFile {
  buffer: Buffer;
  originalname: string;
}
export interface ParsedDelivery {
  packs: Record<string, unknown>[];
  rowNumbers: number[];
  totalRows: number;
  issues: ManifestIssue[];
}

@Injectable()
export class ManifestSpreadsheetService {
  async template(format: string) {
    if (!['csv', 'xlsx'].includes(format))
      throw new BadRequestException(
        'Choose xlsx or csv for the delivery template.',
      );
    if (format === 'csv')
      return {
        buffer: Buffer.from(
          `\uFEFF# ${instructions}\r\n${headers.join(',')}\r\n`,
          'utf8',
        ),
        contentType: 'text/csv; charset=utf-8',
        filename: 'pharmacy-delivery-template.csv',
      };
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Delivery packs', {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = headers.map((header, index) => ({
      header,
      width: index === 0 ? 25 : 28,
      style: { numFmt: index === 3 ? 'yyyy-mm-dd' : '@' },
    }));
    sheet.getRow(1).height = 30;
    sheet.getRow(1).eachCell((cell) => {
      cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
      cell.fill = {
        type: 'pattern',
        pattern: 'solid',
        fgColor: { argb: 'FF23465E' },
      };
      cell.alignment = { vertical: 'middle', wrapText: true };
      cell.note = instructions;
    });
    sheet.headerFooter.oddFooter =
      '&LOne row per individual pack/vial. Preserve leading zeros and case.';
    sheet.autoFilter = 'A1:D1';
    return {
      buffer: Buffer.from(await workbook.xlsx.writeBuffer()),
      contentType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      filename: 'pharmacy-delivery-template.xlsx',
    };
  }

  async parse(file: DeliveryFile | undefined): Promise<ParsedDelivery> {
    if (!file?.buffer.length)
      throw new BadRequestException('Choose a CSV or .xlsx delivery file.');
    if (file.buffer.length > 5 * 1024 * 1024)
      throw new PayloadTooLargeException(
        'The delivery file must be 5 MiB or smaller.',
      );
    const extension = extname(file.originalname).toLowerCase();
    if (!['.csv', '.xlsx'].includes(extension))
      throw new UnsupportedMediaTypeException(
        'Use a CSV or .xlsx delivery file. PDF and older .xls files are not supported.',
      );
    if (extension === '.csv') return this.mapRows(this.csv(file.buffer), false);
    const rawNumbers = checkXlsxArchive(file.buffer);
    const workbook = new Workbook();
    try {
      await workbook.xlsx.load(
        file.buffer as unknown as Parameters<typeof workbook.xlsx.load>[0],
      );
    } catch {
      throw new BadRequestException(
        'This Excel file could not be read. Save it again as .xlsx using the delivery template.',
      );
    }
    const populated: SheetRow[][] = [];
    for (const sheet of workbook.worksheets) {
      const rows: SheetRow[] = [];
      sheet.eachRow((row) => {
        const cells: CellValue[] = [];
        row.eachCell((cell, col) => {
          let value = cell.value;
          if (value instanceof Date) {
            // Retain the source serial so Excel's nonexistent 1900-02-29 is
            // rejected and early dates are not shifted by a library conversion.
            const serial = rawNumbers.get(sheet.id)?.get(cell.address);
            const date1904 = workbook.properties.date1904 === true;
            if (
              serial === undefined ||
              !Number.isInteger(serial) ||
              serial < (date1904 ? 0 : 1) ||
              (!date1904 && serial === 60)
            )
              value = 'INVALID_EXCEL_DATE';
            else {
              const days = serial - (!date1904 && serial > 60 ? 1 : 0);
              value = new Date(
                Date.UTC(
                  date1904 ? 1904 : 1899,
                  date1904 ? 0 : 11,
                  date1904 ? 1 : 31,
                ) +
                  days * 86400000,
              );
            }
          }
          cells[col - 1] = value;
        });
        if (
          cells.some(
            (value) => value !== null && value !== undefined && value !== '',
          )
        )
          rows.push({ row: row.number, cells });
      });
      if (rows.length) populated.push(rows);
    }
    if (populated.length > 1)
      throw new BadRequestException(
        'This workbook has more than one nonempty worksheet. Copy the delivery to a file with one worksheet and upload it again.',
      );
    return this.mapRows(populated[0] ?? [], true);
  }

  private csv(buffer: Buffer): SheetRow[] {
    let text: string;
    try {
      text = new TextDecoder('utf-8', { fatal: true })
        .decode(buffer)
        .replace(/^\uFEFF/, '');
    } catch {
      throw new BadRequestException(
        'Save this CSV as UTF-8, or upload an .xlsx file.',
      );
    }
    if (text.includes('\0'))
      throw new BadRequestException(
        'This is not a readable CSV. Save it as UTF-8 CSV or .xlsx.',
      );
    const rows: SheetRow[] = [];
    let cells: string[] = [],
      value = '',
      quoted = false,
      closed = false,
      line = 1,
      startLine = 1,
      count = 0;
    const malformed = () => {
      throw new BadRequestException(
        `The CSV has invalid quoting near row ${line}. Export it again using comma-separated columns.`,
      );
    };
    const cell = () => {
      cells.push(value);
      value = '';
      closed = false;
      if (++count > 12000 || cells.length > 32)
        throw new BadRequestException(
          'The CSV has too many cells or columns. Keep only the four delivery columns.',
        );
    };
    const row = () => {
      cell();
      if (cells.some((v) => v !== '')) rows.push({ row: startLine, cells });
      cells = [];
      startLine = line + 1;
    };
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      if (quoted) {
        if (char === '"') {
          if (text[i + 1] === '"') {
            value += '"';
            i++;
          } else {
            quoted = false;
            closed = true;
          }
        } else {
          value += char;
          if (char === '\n') line++;
        }
      } else if (char === ',') cell();
      else if (char === '\n' || char === '\r') {
        if (char === '\r' && text[i + 1] === '\n') i++;
        row();
        line++;
        if (line > 10000)
          throw new BadRequestException(
            'The CSV contains too many file rows. Remove unused rows and split deliveries into at most 1,000 packs.',
          );
      } else if (char === '"') {
        if (value || closed) malformed();
        quoted = true;
      } else {
        if (closed) malformed();
        value += char;
      }
      if (value.length > 512)
        throw new BadRequestException(
          `Row ${startLine}: a cell is too long. Keep only the barcode, batch, serial and expiry columns.`,
        );
    }
    if (quoted) malformed();
    if (value || cells.length || closed) row();
    return rows;
  }

  private mapRows(source: SheetRow[], excel: boolean): ParsedDelivery {
    const rows = [...source];
    // The CSV template carries brief instructions as an initial comment record.
    while (
      !excel &&
      rows[0]?.cells.length === 1 &&
      typeof rows[0].cells[0] === 'string' &&
      rows[0].cells[0].startsWith('# ')
    )
      rows.shift();
    const header = rows.shift();
    const issues: ManifestIssue[] = [],
      mapping = new Map<string, number>();
    if (header)
      header.cells.forEach((value, index) => {
        const label =
          typeof value === 'string' ? value.trim().toLowerCase() : '';
        const field = fields.find(
          (name, i) => name === label || headers[i].toLowerCase() === label,
        );
        if (!field)
          issues.push(
            issue(
              header.row,
              'columns',
              'COLUMN_UNEXPECTED',
              'Use only Barcode (GTIN), Batch number, Serial number and Expiry date columns.',
            ),
          );
        else if (mapping.has(field))
          issues.push(
            issue(
              header.row,
              field,
              'COLUMN_AMBIGUOUS',
              `Keep only one ${headers[fields.indexOf(field)]} column.`,
            ),
          );
        else mapping.set(field, index);
      });
    for (const field of fields)
      if (!mapping.has(field))
        issues.push(
          issue(
            header?.row ?? 1,
            field,
            'COLUMN_REQUIRED',
            `Add the ${headers[fields.indexOf(field)]} column.`,
          ),
        );
    const packs: Record<string, unknown>[] = [],
      rowNumbers: number[] = [];
    if (rows.length > 1000)
      issues.push(
        issue(
          0,
          'packs',
          'ROW_LIMIT_EXCEEDED',
          'Use no more than 1,000 nonempty pack rows per delivery.',
        ),
      );
    for (const row of rows.slice(0, 1000)) {
      const pack: Record<string, unknown> = {};
      row.cells.forEach((value, index) => {
        if (
          value !== undefined &&
          value !== null &&
          value !== '' &&
          ![...mapping.values()].includes(index)
        )
          issues.push(
            issue(
              row.row,
              'columns',
              'COLUMN_UNEXPECTED',
              'Remove data outside the four delivery columns.',
            ),
          );
      });
      for (const field of fields) {
        const index = mapping.get(field),
          value = index === undefined ? undefined : row.cells[index];
        if (
          value &&
          typeof value === 'object' &&
          ('formula' in value || 'sharedFormula' in value)
        ) {
          issues.push(
            issue(
              row.row,
              field,
              'FORMULA_NOT_ALLOWED',
              'Replace formulas with the original value printed on the pack. Cached formula results cannot be imported.',
            ),
          );
          pack[field] = '';
          continue;
        }
        if (field === 'expiry') {
          if (
            value instanceof Date &&
            Number.isFinite(value.getTime()) &&
            value.getUTCHours() === 0 &&
            value.getUTCMinutes() === 0 &&
            value.getUTCSeconds() === 0 &&
            value.getUTCMilliseconds() === 0
          )
            pack[field] = value.toISOString().slice(0, 10);
          else if (
            typeof value === 'string' &&
            /^\d{4}-\d{2}-\d{2}$/.test(value)
          )
            pack[field] = value;
          else {
            pack[field] = '';
            issues.push(
              issue(
                row.row,
                field,
                'INVALID_EXPIRY',
                'Enter a real Excel date or a valid YYYY-MM-DD date. Dates such as 03/04/27 are ambiguous.',
              ),
            );
          }
        } else {
          pack[field] = typeof value === 'string' ? value : '';
          if (
            value !== undefined &&
            value !== null &&
            value !== '' &&
            (typeof value !== 'string' ||
              (!excel && /^[+-]?(?:\d+\.?\d*|\.\d+)[eE][+-]?\d+$/.test(value)))
          )
            issues.push(
              issue(
                row.row,
                field,
                'IDENTIFIER_MUST_BE_TEXT',
                'Format this cell as Text and re-enter the complete identifier from the pack. Do not use numbers or scientific notation; lost zeros cannot be recovered.',
              ),
            );
          if (typeof value === 'string' && /^\s*=/.test(value))
            issues.push(
              issue(
                row.row,
                field,
                'FORMULA_NOT_ALLOWED',
                'Replace this formula with the original identifier printed on the pack.',
              ),
            );
        }
      }
      packs.push(pack);
      rowNumbers.push(row.row);
    }
    return { packs, rowNumbers, totalRows: rows.length, issues };
  }
}
