export function deterministicId(prefix: string, path: string): string {
  const normalized = encodeURIComponent(path);
  return `${prefix}_${normalized}`;
}
