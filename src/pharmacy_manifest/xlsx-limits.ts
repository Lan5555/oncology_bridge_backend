import { BadRequestException } from '@nestjs/common';
import { inflateRawSync } from 'node:zlib';
import { posix } from 'node:path';

function attributes(text: string) {
  return Object.fromEntries(
    [...text.matchAll(/([\w:.-]+)\s*=\s*(["'])(.*?)\2/gs)].map((match) => [
      match[1],
      match[3],
    ]),
  );
}

// Check the archive before ExcelJS expands or allocates worksheets. ZIP64,
// encryption, macros and unusual archive layouts are intentionally unsupported.
export function checkXlsxArchive(buffer: Buffer) {
  const fail = () => {
    throw new BadRequestException(
      'This Excel file is malformed or too complex. Save a new .xlsx file with only the delivery sheet and at most 1,000 pack rows.',
    );
  };
  try {
    let end = -1;
    for (
      let i = buffer.length - 22;
      i >= Math.max(0, buffer.length - 65557);
      i--
    ) {
      if (
        buffer.readUInt32LE(i) === 0x06054b50 &&
        i + 22 + buffer.readUInt16LE(i + 20) === buffer.length
      ) {
        end = i;
        break;
      }
    }
    if (end < 0) return fail();
    const count = buffer.readUInt16LE(end + 10),
      offset = buffer.readUInt32LE(end + 16);
    if (
      !count ||
      count > 256 ||
      buffer.readUInt16LE(end + 4) ||
      buffer.readUInt16LE(end + 6) ||
      buffer.readUInt16LE(end + 8) !== count ||
      offset + buffer.readUInt32LE(end + 12) !== end
    )
      return fail();
    let cursor = offset,
      expanded = 0,
      cells = 0,
      rows = 0;
    const names = new Set<string>();
    const numericSheets = new Map<string, Map<string, number>>();
    let workbookXml = '',
      relationshipsXml = '';
    for (let n = 0; n < count; n++) {
      if (buffer.readUInt32LE(cursor) !== 0x02014b50) return fail();
      const flags = buffer.readUInt16LE(cursor + 8),
        method = buffer.readUInt16LE(cursor + 10);
      const compressed = buffer.readUInt32LE(cursor + 20),
        size = buffer.readUInt32LE(cursor + 24);
      const nameLength = buffer.readUInt16LE(cursor + 28),
        local = buffer.readUInt32LE(cursor + 42);
      const name = buffer
        .subarray(cursor + 46, cursor + 46 + nameLength)
        .toString('utf8');
      if (
        flags & 1 ||
        ![0, 8].includes(method) ||
        names.has(name) ||
        name.includes('..') ||
        name.includes('\\') ||
        name.startsWith('/') ||
        /vbaProject|embeddings\//i.test(name)
      )
        return fail();
      names.add(name);
      expanded += size;
      if (
        expanded > 16 * 1024 * 1024 ||
        size > 8 * 1024 * 1024 ||
        local >= offset ||
        buffer.readUInt32LE(local) !== 0x04034b50 ||
        buffer.readUInt16LE(local + 8) !== method
      )
        return fail();
      const start =
        local +
        30 +
        buffer.readUInt16LE(local + 26) +
        buffer.readUInt16LE(local + 28);
      const localName = buffer
        .subarray(local + 30, local + 30 + buffer.readUInt16LE(local + 26))
        .toString('utf8');
      if (localName !== name || buffer.readUInt16LE(local + 6) !== flags)
        return fail();
      if (start + compressed > offset) return fail();
      const data =
        method === 0
          ? buffer.subarray(start, start + compressed)
          : inflateRawSync(buffer.subarray(start, start + compressed), {
              maxOutputLength: Math.min(size + 1, 8 * 1024 * 1024),
            });
      if (data.length !== size) return fail();
      if (/\.xml$|\.rels$/i.test(name)) {
        const xml = data.toString('utf8');
        if (name === 'xl/workbook.xml') workbookXml = xml;
        if (name === 'xl/_rels/workbook.xml.rels') relationshipsXml = xml;
        if (/<!DOCTYPE|<!ENTITY/i.test(xml)) return fail();
        // Bound coordinates in comments, selections and other XML too: these
        // can cause allocations during reconciliation even without cell data.
        for (const attr of xml.matchAll(
          /\b(?:r|ref|sqref|activeCell|topLeftCell)\s*=\s*(["'])(.*?)\1/gs,
        )) {
          if (attr[2].includes('&')) return fail();
          for (const coord of attr[2].matchAll(/\$?([A-Z]+)\$?(\d+)/g)) {
            if (
              coord[1].length > 2 ||
              (coord[1].length === 2 && coord[1] > 'AF') ||
              Number(coord[2]) > 10000
            )
              return fail();
          }
        }
        // Named ranges are not needed for delivery imports and may expand a
        // whole-sheet range while ExcelJS reconciles workbook metadata.
        if (/<(?:[\w.-]+:)?definedName(?=[\s>])/.test(xml)) return fail();
        if (/^xl\/worksheets\/[^/]+\.xml$/.test(name)) {
          const cellPattern = /<(?:[\w.-]+:)?c(?=[\s>])/g;
          while (cellPattern.exec(xml)) if (++cells > 12000) return fail();
          const rowPattern = /<(?:[\w.-]+:)?row(?=[\s>])/g;
          while (rowPattern.exec(xml)) if (++rows > 10000) return fail();
          if (/\b(?:r|min|max)\s*=\s*(["'])[^"']*&/.test(xml)) return fail();
          const numeric = new Map<string, number>();
          for (const cell of xml.matchAll(
            /<(?:[\w.-]+:)?c\b([^>]*?)(?:\/>|>(.*?)<\/(?:[\w.-]+:)?c>)/gs,
          )) {
            const attr = attributes(cell[1]);
            const value = cell[2]?.match(
              /<(?:[\w.-]+:)?v\b[^>]*>([^<]*)<\/(?:[\w.-]+:)?v>/,
            );
            if ((!attr.t || attr.t === 'n') && attr.r && value)
              numeric.set(attr.r, Number(value[1]));
          }
          numericSheets.set(name, numeric);
          if (/<(?:[\w.-]+:)?mergeCell(?=[\s>])/.test(xml)) return fail();
          for (const match of xml.matchAll(
            /\br\s*=\s*(["'])([A-Z]+)(\d+)\1/g,
          )) {
            if (
              match[2].length > 2 ||
              Number(match[3]) > 10000 ||
              (match[2].length === 2 && match[2] > 'AF')
            )
              return fail();
          }
          for (const match of xml.matchAll(
            /<(?:[\w.-]+:)?row\b[^>]*\br\s*=\s*(["'])(\d+)\1/g,
          ))
            if (Number(match[2]) > 10000) return fail();
          for (const match of xml.matchAll(
            /<(?:[\w.-]+:)?col\b[^>]*\bmax\s*=\s*(["'])(\d+)\1/g,
          ))
            if (Number(match[2]) > 32) return fail();
        }
      }
      cursor +=
        46 +
        nameLength +
        buffer.readUInt16LE(cursor + 30) +
        buffer.readUInt16LE(cursor + 32);
    }
    if (
      cursor !== end ||
      !names.has('xl/workbook.xml') ||
      !names.has('[Content_Types].xml')
    )
      return fail();
    const targets = new Map<string, string>();
    for (const relation of relationshipsXml.matchAll(
      /<(?:[\w.-]+:)?Relationship\b([^>]*)\/?\s*>/g,
    )) {
      const attr = attributes(relation[1]);
      if (attr.Id && attr.Target)
        targets.set(
          attr.Id,
          attr.Target.startsWith('/')
            ? attr.Target.slice(1)
            : posix.normalize(posix.join('xl', attr.Target)),
        );
    }
    const numericBySheetId = new Map<number, Map<string, number>>();
    for (const sheet of workbookXml.matchAll(
      /<(?:[\w.-]+:)?sheet\b([^>]*)\/?\s*>/g,
    )) {
      const attr = attributes(sheet[1]),
        target = targets.get(attr['r:id']);
      if (target && numericSheets.has(target))
        numericBySheetId.set(Number(attr.sheetId), numericSheets.get(target)!);
    }
    return numericBySheetId;
  } catch {
    return fail();
  }
}
