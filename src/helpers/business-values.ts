/* eslint-disable no-control-regex -- Business labels must reject control characters. */
import { UnprocessableEntityException } from '@nestjs/common';

export function businessLabel(
  value: unknown,
  field: string,
  maxLength: number,
): string {
  if (
    typeof value !== 'string' ||
    !value.trim() ||
    value.trim().length > maxLength ||
    /[\u0000-\u001f\u007f]/.test(value)
  )
    throw new UnprocessableEntityException(
      `${field} must be nonblank text of at most ${maxLength} characters without control characters`,
    );
  return value.trim().normalize('NFC');
}

export function currencyPreference(value: unknown): string | null {
  if (value === null || (typeof value === 'string' && !value.trim()))
    return null;
  if (typeof value !== 'string')
    throw new UnprocessableEntityException(
      'currency must be an ISO 4217 currency code, or blank to clear the preference',
    );
  const currency = value.trim().toUpperCase();
  if (!Intl.supportedValuesOf('currency').includes(currency))
    throw new UnprocessableEntityException(
      'currency must be a supported ISO 4217 code such as NGN, USD or EUR; leave it blank to clear the preference',
    );
  return currency;
}

export function recordedNumber(value: unknown): number | null {
  if (
    (typeof value !== 'number' && typeof value !== 'string') ||
    (typeof value === 'string' && !value.trim())
  )
    return null;
  const number = Number(value);
  return Number.isFinite(number) ? number : null;
}
