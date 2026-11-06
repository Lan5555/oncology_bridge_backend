/** Access unknown HTTP/SQL JSON without leaking library `any` into assertions. */
export function jsonAt(value: unknown, ...keys: (string | number)[]): unknown {
  let current = value;
  for (const key of keys) {
    if (typeof current !== 'object' || current === null) {
      throw new Error(`Expected a JSON object while reading ${String(key)}`);
    }
    current = (current as Record<string | number, unknown>)[key];
  }
  return current;
}

export function jsonArrayAt(
  value: unknown,
  ...keys: (string | number)[]
): unknown[] {
  const result = jsonAt(value, ...keys);
  if (!Array.isArray(result)) throw new Error('Expected a JSON array');
  return result as unknown[];
}
