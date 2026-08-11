import { AssetTrackerDb } from '../../storage/db';
import { AssetStateAnchorRepository } from '../../storage/repositories/assetStateAnchorRepository';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';

export interface AssetStateAnchorListItem {
  id: string;
  categoryId: string;
  categoryName: string;
  categoryKind: 'asset' | 'debt' | 'group';
  currency: string;
  amount: number;
  anchoredAt: string;
  note: string;
  updatedAt: string;
}

export async function listAssetStateAnchorsForBook(
  db: AssetTrackerDb,
  bookId: string
): Promise<AssetStateAnchorListItem[]> {
  const [anchors, categories] = await Promise.all([
    new AssetStateAnchorRepository(db).listByBook(bookId),
    new CategoryRepository(db).listByBook(bookId)
  ]);
  const categoryById = new Map(
    categories.filter((category) => category.deletedAt === null).map((category) => [category.id, category])
  );

  return anchors
    .filter((anchor) => anchor.deletedAt === null)
    .map((anchor) => ({
      id: anchor.id,
      categoryId: anchor.categoryId,
      categoryName: categoryById.get(anchor.categoryId)?.name ?? '已删除分类',
      categoryKind: categoryById.get(anchor.categoryId)?.kind ?? 'asset',
      currency: anchor.currency,
      amount: anchor.amount,
      anchoredAt: anchor.anchoredAt,
      note: anchor.note,
      updatedAt: anchor.updatedAt
    }))
    .sort((left, right) => right.anchoredAt.localeCompare(left.anchoredAt));
}
