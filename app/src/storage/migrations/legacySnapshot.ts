export function buildLegacyRawBackup(input: unknown): string {
  return JSON.stringify(input, null, 2);
}
