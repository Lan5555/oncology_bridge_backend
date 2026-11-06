import { BadRequestException } from '@nestjs/common';
import { Gs1Identifiers, normalizeGs1Expiry, validateGtin } from './gs1-parser';

// Deliberately reject unsupported/ambiguous data instead of guessing AI boundaries.
export function verificationBarcode(raw: string): Gs1Identifiers {
  const text = raw.trim().replace(/^\]d2/i, '');
  const values = new Map<string, string>();
  let offset = 0;
  const humanReadable = text.startsWith('(');
  while (offset < text.length) {
    if (text[offset] === '\u001d') {
      offset++;
      continue;
    }
    const token = humanReadable
      ? /^\((01|10|17|21)\)/.exec(text.slice(offset))
      : /^(01|10|17|21)/.exec(text.slice(offset));
    if (!token || values.has(token[1]))
      throw new BadRequestException(
        'Unsupported or repeated GS1 application identifier.',
      );
    const ai = token[1];
    offset += token[0].length;
    let end: number;
    if (humanReadable) {
      const next = text.indexOf('(', offset);
      end = next < 0 ? text.length : next;
    } else if (ai === '01' || ai === '17') {
      end = offset + (ai === '01' ? 14 : 6);
    } else {
      const separator = text.indexOf('\u001d', offset);
      end = separator < 0 ? text.length : separator;
    }
    const value = text.slice(offset, end);
    if (
      (ai === '01' && !/^\d{14}$/.test(value)) ||
      (ai === '17' && (!/^\d{6}$/.test(value) || !normalizeGs1Expiry(value))) ||
      (['10', '21'].includes(ai) && !/^[\x21-\x27\x2a-\x7e]{1,20}$/.test(value))
    ) {
      throw new BadRequestException(
        'Invalid GS1 value. Preserve FNC1/group separators between variable-length fields.',
      );
    }
    values.set(ai, value);
    offset = end;
  }
  const gtin = values.get('01') ?? null;
  if (!validateGtin(gtin))
    throw new BadRequestException(
      'A valid GTIN-14 with a correct check digit is required.',
    );
  return {
    gtin,
    lot: values.get('10') ?? null,
    serial: values.get('21') ?? null,
    expiry: normalizeGs1Expiry(values.get('17') ?? null),
  };
}
