import type { AssetStateAnchor, CurrencyCode } from '../../shared/types/entities';
import { assetStateAnchorSchema } from '../../shared/validation/schemas';
import { bumpMetadata, createMetadata } from '../../shared/utils/entityMetadata';
import { toMinorUnits } from '../../shared/utils/money';
import { AssetTrackerDb } from '../../storage/db';
import { AssetStateAnchorRepository } from '../../storage/repositories/assetStateAnchorRepository';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';
import { normalizeAssetStateAmount } from './normalizeAssetStateAmount';

export interface CreateAssetStateAnchorInput {
  bookId: string;
  categoryId: string;
  amount: number;
  currency: CurrencyCode;
  anchoredAt: string;
  note: string;
}

export async function createAssetStateAnchor(
  db: AssetTrackerDb,
  input: CreateAssetStateAnchorInput
): Promise<AssetStateAnchor> {
  const categoryRepository = new CategoryRepository(db);
  const anchorRepository = new AssetStateAnchorRepository(db);
  const [categories, anchors] = await Promise.all([
    categoryRepository.listByBook(input.bookId),
    anchorRepository.listByCategory(input.categoryId)
  ]);
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
  const existing = anchors.find(
    (anchor) => anchor.deletedAt === null && anchor.anchoredAt === input.anchoredAt
  );

  const anchor = assetStateAnchorSchema.parse(
    existing
      ? {
          ...existing,
          amount: toMinorUnits(normalizeAssetStateAmount(input.amount, category.kind)),
          currency: input.currency,
          note: input.note.trim(),
          ...bumpMetadata(existing, now)
        }
      : {
          id: `anchor_${crypto.randomUUID()}`,
          bookId: input.bookId,
          categoryId: input.categoryId,
          amount: toMinorUnits(normalizeAssetStateAmount(input.amount, category.kind)),
          currency: input.currency,
          anchoredAt: input.anchoredAt,
          note: input.note.trim(),
          ...createMetadata(now)
        }
  );

  await anchorRepository.put(anchor);

  return anchor;
}
