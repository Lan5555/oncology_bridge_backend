export interface Gs1Identifiers {
  gtin: string | null;
  lot: string | null;
  expiry: string | null;
  serial: string | null;
}

export interface Gs1Validation {
  valid: boolean;
  status: 'VALID' | 'INVALID';
  messages: string[];
}

const GS = '\u001d';

export function parseGs1(raw: string): Gs1Identifiers {
  const identifiers: Gs1Identifiers = {
    gtin: null,
    lot: null,
    expiry: null,
    serial: null,
  };
  const text = raw.trim().replace(/^\](?:d2|C1)/i, '');
  const invalid = (): Gs1Identifiers => ({
    gtin: null,
    lot: null,
    expiry: null,
    serial: null,
  });
  const seen = new Set<string>();

  if (/\(01\)/.test(text)) {
    const matches = [...text.matchAll(/\((01|10|17|21)\)([^()]*)/g)];
    if (matches.map((match) => match[0]).join('') !== text) return invalid();
    for (const match of matches) {
      if (seen.has(match[1])) return invalid();
      seen.add(match[1]);
      const value = match[2];
      if (match[1] === '01' && !/^\d{14}$/.test(value)) return invalid();
      if (match[1] === '17' && !/^\d{6}$/.test(value)) return invalid();
      if (match[1] === '01') identifiers.gtin = value ?? null;
      if (match[1] === '10') identifiers.lot = value ?? null;
      if (match[1] === '17') identifiers.expiry = value ?? null;
      if (match[1] === '21') identifiers.serial = value ?? null;
    }
    return identifiers;
  }

  let i = 0;
  while (i < text.length) {
    if (text[i] === GS) {
      i++;
      continue;
    }
    const ai = text.slice(i, i + 2);
    if (seen.has(ai)) return invalid();
    seen.add(ai);
    i += 2;
    if (ai === '01' || ai === '17') {
      const size = ai === '01' ? 14 : 6;
      const value = text.slice(i, i + size);
      i += size;
      if (ai === '01') identifiers.gtin = value;
      else identifiers.expiry = value;
      continue;
    }
    if (ai === '10' || ai === '21') {
      const end = text.indexOf(GS, i);
      const value = text.slice(i, end === -1 ? text.length : end);
      if (ai === '10') identifiers.lot = value;
      else identifiers.serial = value;
      i = end === -1 ? text.length : end + 1;
      continue;
    }
    return invalid();
  }
  return identifiers;
}

export function validateGtin(gtin: string | null): boolean {
  if (!gtin || !/^\d{14}$/.test(gtin)) return false;
  const digits = [...gtin].map(Number);
  const sum = digits
    .slice(0, 13)
    .reduce(
      (total, digit, index) => total + digit * (index % 2 === 0 ? 3 : 1),
      0,
    );
  return (10 - (sum % 10)) % 10 === digits[13];
}

export function normalizeGs1Expiry(value: string | null): string | null {
  if (!value) return null;
  if (/^\d{6}$/.test(value)) {
    const year = 2000 + Number(value.slice(0, 2));
    const month = Number(value.slice(2, 4));
    const day = Number(value.slice(4, 6));
    if (month < 1 || month > 12 || day > 31) return null;
    const date =
      day === 0
        ? new Date(Date.UTC(year, month, 0))
        : new Date(Date.UTC(year, month - 1, day));
    if (day !== 0 && date.getUTCDate() !== day) return null;
    return date.toISOString().slice(0, 10);
  }
  if (!/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) &&
    date.toISOString().slice(0, 10) === value
    ? value
    : null;
}

export function validateIdentifiers(ids: Gs1Identifiers): Gs1Validation {
  const messages: string[] = [];
  if (!validateGtin(ids.gtin))
    messages.push('GTIN must be a valid GTIN-14 with a correct check digit.');
  if (!ids.lot || !/^[!-~]{1,20}$/.test(ids.lot))
    messages.push(
      'Lot/batch identifier (AI 10) must contain 1 to 20 printable characters without spaces.',
    );
  if (!normalizeGs1Expiry(ids.expiry))
    messages.push('Expiry (AI 17) is missing or is not a valid date.');
  if (!ids.serial || !/^[!-~]{1,20}$/.test(ids.serial))
    messages.push(
      'Serial identifier (AI 21) must contain 1 to 20 printable characters without spaces.',
    );
  return {
    valid: messages.length === 0,
    status: messages.length ? 'INVALID' : 'VALID',
    messages,
  };
}
