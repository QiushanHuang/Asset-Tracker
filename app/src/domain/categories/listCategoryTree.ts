import type { CurrencyCode } from '../../shared/types/entities';
import { AssetTrackerDb } from '../../storage/db';
import { buildCategoryTreeSnapshot, loadBalanceContext } from '../balances/balanceEngine';

export interface CategoryTreeItem {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  kind: 'asset' | 'debt' | 'group';
  currency: CurrencyCode;
  aggregateAmount: number | null;
  sortOrder: number;
}

export async function listCategoryTree(
  db: AssetTrackerDb,
  bookId: string,
  options?: { asOf?: string }
): Promise<CategoryTreeItem[]> {
  const context = await loadBalanceContext(db, bookId);

  return buildCategoryTreeSnapshot(context, options?.asOf ?? new Date().toISOString());
}
