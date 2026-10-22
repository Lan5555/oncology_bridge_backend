import { recordedNumber } from '../helpers/business-values';

export function recordedTimestamp(value: unknown): string | null {
  if (!(value instanceof Date) && (typeof value !== 'string' || !value.trim()))
    return null;
  const date = value instanceof Date ? value : new Date(value);
  return Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

export function readingPresentation(
  input: {
    temperature?: unknown;
    recordedAt?: unknown;
    targetMin?: unknown;
    targetMax?: unknown;
    lastSeenAt?: unknown;
    offlineAfterSeconds?: unknown;
    operationalState?: unknown;
  },
  now = Date.now(),
) {
  const currentReadingAt = recordedTimestamp(input.recordedAt);
  const currentC = currentReadingAt ? recordedNumber(input.temperature) : null;
  const min = recordedNumber(input.targetMin),
    max = recordedNumber(input.targetMax);
  const validLimits = min !== null && max !== null && min < max;
  const lastSeenAt = recordedTimestamp(input.lastSeenAt);
  const timeout = recordedNumber(input.offlineAfterSeconds);
  const offline =
    input.operationalState === 'OFFLINE' ||
    (lastSeenAt !== null &&
      timeout !== null &&
      timeout > 0 &&
      now - Date.parse(lastSeenAt) > timeout * 1000);
  return {
    currentReadingAt,
    currentC,
    lastSeenAt,
    targetMin: validLimits ? min : null,
    targetMax: validLimits ? max : null,
    readingState: offline
      ? 'OFFLINE'
      : currentC === null || !validLimits
        ? 'UNKNOWN'
        : currentC < min || currentC > max
          ? 'BREACH'
          : 'NOMINAL',
  };
}

const validNumeric = (column: string) =>
  `(${column} IS NOT NULL AND ${column}::text NOT IN ('NaN','Infinity','-Infinity'))`;
export const validStorageLimits = `(${validNumeric('unit.target_min')} AND ${validNumeric('unit.target_max')} AND unit.target_min<unit.target_max)`;
export const storageReadingStateSql = `CASE
  WHEN unit.operational_state='OFFLINE' OR (unit.last_seen_at IS NOT NULL AND unit.offline_after_seconds>0 AND unit.last_seen_at<now()-unit.offline_after_seconds*interval '1 second') THEN 'OFFLINE'
  WHEN reading.recorded_at IS NULL OR NOT isfinite(reading.recorded_at) OR NOT ${validNumeric('reading.temperature')} OR NOT ${validStorageLimits} THEN 'UNKNOWN'
  WHEN reading.temperature<unit.target_min OR reading.temperature>unit.target_max THEN 'BREACH'
  ELSE 'NOMINAL' END`;
