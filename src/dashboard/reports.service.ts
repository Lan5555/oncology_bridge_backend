import { Injectable } from '@nestjs/common';
import { DataSource } from 'typeorm';
import PDFDocument from 'pdfkit';
import { Workbook } from 'exceljs';
import { isISO8601 } from 'class-validator';
import {
  FormOptionsService,
  REPORT_FORMATS,
  contractError,
} from '../form_options/form-options.service';
import { ResponseHelper } from '../helpers/response-helper';

const HEADERS = [
  'id',
  'drug',
  'gtin',
  'lot',
  'facility',
  'quantity',
  'unit',
  'expiry',
  'status',
];
type Cell = string | number | null;
export function reportCsv(rows: Cell[][]) {
  return [HEADERS, ...rows]
    .map((row) =>
      row
        .map((value) => {
          const text = value === null ? '' : String(value);
          const safe = /^[\s]*[=+\-@]/.test(text) ? `'${text}` : text;
          return `"${safe.replace(/"/g, '""')}"`;
        })
        .join(','),
    )
    .join('\r\n');
}
export async function reportFile(
  type: string,
  rows: Cell[][],
): Promise<{ bytes: Buffer; mimeType: string; csv?: string }> {
  if (type === 'CSV') {
    const csv = reportCsv(rows);
    return { bytes: Buffer.from(csv, 'utf8'), mimeType: 'text/csv', csv };
  }
  if (type === 'XLSX') {
    const workbook = new Workbook();
    const sheet = workbook.addWorksheet('Inventory');
    sheet.addRow(HEADERS);
    sheet.addRows(rows);
    sheet.getRow(1).font = { bold: true, color: { argb: 'FFFFFFFF' } };
    sheet.getRow(1).fill = {
      type: 'pattern',
      pattern: 'solid',
      fgColor: { argb: 'FF123D43' },
    };
    sheet.columns.forEach((column, index) => {
      column.width = [38, 32, 20, 24, 32, 12, 12, 14, 20][index];
    });
    sheet.views = [{ state: 'frozen', ySplit: 1 }];
    sheet.autoFilter = { from: 'A1', to: 'I1' };
    return {
      bytes: Buffer.from(await workbook.xlsx.writeBuffer()),
      mimeType:
        'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
    };
  }
  if (type !== 'PDF')
    contractError(
      501,
      'REPORT_FORMAT_UNAVAILABLE',
      'This report format is not available.',
    );
  const bytes = await new Promise<Buffer>((resolve, reject) => {
    const doc = new PDFDocument({
      size: 'A4',
      margin: 42,
      info: { Title: 'Inventory report' },
    });
    const chunks: Buffer[] = [];
    doc.on('data', (chunk: Buffer) => chunks.push(chunk));
    doc.on('error', reject);
    doc.on('end', () => resolve(Buffer.concat(chunks)));
    doc.fontSize(22).fillColor('#123D43').text('Inventory report');
    doc.moveDown().fontSize(9).fillColor('#222222');
    if (!rows.length)
      doc.text('No recorded inventory matches the selected period.');
    for (const row of rows) {
      HEADERS.forEach((header, index) =>
        doc.text(
          `${header}: ${row[index] === null ? 'Not provided' : row[index]}`,
          { lineGap: 2 },
        ),
      );
      doc.moveDown();
    }
    doc.end();
  });
  return { bytes, mimeType: 'application/pdf' };
}

@Injectable()
export class ReportsService {
  constructor(
    private readonly db: DataSource,
    private readonly options: FormOptionsService,
  ) {}
  async export(
    body: { type?: unknown; from?: unknown; to?: unknown },
    actorId: string,
  ) {
    if (
      !body ||
      typeof body !== 'object' ||
      Array.isArray(body) ||
      Object.keys(body).some((key) => !['type', 'from', 'to'].includes(key))
    )
      contractError(422, 'INVALID_REPORT', 'Send only type, from, and to.');
    if (
      typeof body.type !== 'string' ||
      !(REPORT_FORMATS as readonly string[]).includes(body.type)
    )
      contractError(
        422,
        'INVALID_REPORT_FORMAT',
        'Select a report format from the reports form options.',
      );
    const boundary = (value: unknown, name: string): Date | null => {
      if (value === undefined || value === null) return null;
      if (
        typeof value !== 'string' ||
        !isISO8601(value, { strict: true }) ||
        (!/^\d{4}-\d{2}-\d{2}$/.test(value) &&
          !/(Z|[+-]\d{2}:\d{2})$/.test(value))
      )
        contractError(
          422,
          'INVALID_REPORT_DATE',
          `${name} must be a valid ISO date or timestamp with a timezone.`,
        );
      const date = new Date(value);
      if (!Number.isFinite(date.getTime()))
        contractError(422, 'INVALID_REPORT_DATE', `${name} is invalid.`);
      if (name === 'to' && /^\d{4}-\d{2}-\d{2}$/.test(value))
        date.setUTCHours(23, 59, 59, 999);
      return date;
    };
    const from = boundary(body.from, 'from'),
      to = boundary(body.to, 'to');
    if (from && to && from > to)
      contractError(
        422,
        'INVALID_REPORT_RANGE',
        'from must be on or before to.',
      );
    const type = body.type;
    return this.db.transaction('REPEATABLE READ', async (manager) => {
      const { facilityId } = await this.options.actor(
        actorId,
        'reports',
        manager,
      );
      const records = await manager.query<Record<string, Cell>[]>(
        `SELECT i.id,m.generic_name drug,m.gtin,i.batch_number lot,h.name facility,i.quantity,i.selling_unit unit,to_char(i.expiry_date,'YYYY-MM-DD') expiry,i.status
        FROM inventory i JOIN medicines m ON m.id=i.medicine_id JOIN hospitals h ON h.id=i.hospital_id
        WHERE m.deleted_at IS NULL AND ($1::uuid IS NULL OR i.hospital_id=$1)
        AND ($2::timestamptz IS NULL OR i.created_at >= $2) AND ($3::timestamptz IS NULL OR i.created_at <= $3)
        ORDER BY i.expiry_date NULLS LAST,i.id LIMIT 10001`,
        [facilityId ?? null, from, to],
      );
      if (records.length > 10000)
        contractError(
          422,
          'REPORT_TOO_LARGE',
          'Select a narrower date range; reports support up to 10,000 inventory rows.',
        );
      const file = await reportFile(
        type,
        records.map((record) => HEADERS.map((key) => record[key] ?? null)),
      );
      await manager.query(
        `INSERT INTO audit_logs(user_id,action,description,ip_address,object_type) VALUES ($1,'REPORT_EXPORTED',$2,'unknown','report')`,
        [
          actorId,
          JSON.stringify({
            type,
            facilityId: facilityId ?? null,
            from: from?.toISOString() ?? null,
            to: to?.toISOString() ?? null,
            rows: records.length,
          }),
        ],
      );
      return ResponseHelper.Success('Report generated', {
        fileName: `inventory-${new Date().toISOString().replace(/[:.]/g, '-')}.${type.toLowerCase()}`,
        mimeType: file.mimeType,
        contentBase64: file.bytes.toString('base64'),
        type,
        ...(file.csv !== undefined ? { csv: file.csv } : {}),
      });
    });
  }
}
