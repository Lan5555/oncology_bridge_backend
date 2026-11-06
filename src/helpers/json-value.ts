/** Narrow untrusted JSON before accessing provider response fields. */
export function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

export function stringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? (value as unknown[]).filter(
        (item): item is string => typeof item === 'string',
      )
    : [];
}
