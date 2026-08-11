export function normalizeAssetStateAmount(
  amount: number,
  kind: 'asset' | 'debt'
): number {
  if (kind === 'debt') {
    return Math.abs(amount) * -1;
  }

  return amount;
}

export function editableAssetStateAmount(
  amount: number,
  kind: 'asset' | 'debt'
): string {
  return ((kind === 'debt' ? Math.abs(amount) : amount) / 100).toFixed(2);
}
