export function buildCategoryPath(parentPath: string | null, name: string): string {
  const encodedSegment = encodeURIComponent(name);
  return parentPath ? `${parentPath}/${encodedSegment}` : encodedSegment;
}
