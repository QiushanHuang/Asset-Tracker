import type { AssetStateAnchor, CurrencyCode } from '../../shared/types/entities';
import { assetStateAnchorSchema } from '../../shared/validation/schemas';
import { bumpMetadata, markDeleted } from '../../shared/utils/entityMetadata';
import { toMinorUnits } from '../../shared/utils/money';
import { AssetTrackerDb } from '../../storage/db';
import { AssetStateAnchorRepository } from '../../storage/repositories/assetStateAnchorRepository';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';
import { normalizeAssetStateAmount } from './normalizeAssetStateAmount';

export interface UpdateAssetStateAnchorInput {
  bookId: string;
  anchorId: string;
  categoryId: string;
  amount: number;
  currency: CurrencyCode;
  anchoredAt: string;
  note: string;
}

export async function updateAssetStateAnchor(
  db: AssetTrackerDb,
  input: UpdateAssetStateAnchorInput
): Promise<AssetStateAnchor> {
  const anchorRepository = new AssetStateAnchorRepository(db);
  const categoryRepository = new CategoryRepository(db);
  const [anchor, categories, categoryAnchors] = await Promise.all([
    anchorRepository.get(input.anchorId),
    categoryRepository.listByBook(input.bookId),
    anchorRepository.listByCategory(input.categoryId)
  ]);

  if (!anchor || anchor.deletedAt !== null || anchor.bookId !== input.bookId) {
    throw new Error('Asset state does not exist');
  }

  const category = categories.find((item) => item.id === input.categoryId && item.deletedAt === null);

  if (!category) {
    throw new Error('Category does not exist');
  }

  if (category.kind === 'group') {
    throw new Error('Cannot set asset state on a group category');
  }

  if (category.currency !== input.currency) {
    throw new Error('Asset state currency must match category currency');
  }

  const now = new Date().toISOString();
  const updated = assetStateAnchorSchema.parse({
    ...anchor,
    categoryId: input.categoryId,
    amount: toMinorUnits(normalizeAssetStateAmount(input.amount, category.kind)),
    currency: input.currency,
    anchoredAt: input.anchoredAt,
    note: input.note.trim(),
    ...bumpMetadata(anchor, now)
  });
  const duplicate = categoryAnchors.find(
    (item) =>
      item.id !== anchor.id &&
      item.deletedAt === null &&
      item.anchoredAt === input.anchoredAt
  );

  await anchorRepository.putMany(
    duplicate
      ? [
          updated,
          assetStateAnchorSchema.parse({
            ...duplicate,
            ...markDeleted(duplicate, now)
          })
        ]
      : [updated]
  );

  return updated;
}
