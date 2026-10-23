export const ICD10_INPUT_MESSAGE =
  'Enter an ICD-10 value between 1 and 200 characters.';

export function isIcd10Input(value: unknown): value is string {
  return (
    typeof value === 'string' && value.trim().length > 0 && value.length <= 200
  );
}

export function normalizeIcd10(code: string): string {
  return code.trim().toUpperCase();
}
