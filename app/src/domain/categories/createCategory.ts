import type { Category, CurrencyCode } from '../../shared/types/entities';
import { categorySchema } from '../../shared/validation/schemas';
import { createMetadata } from '../../shared/utils/entityMetadata';
import { AssetTrackerDb } from '../../storage/db';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';

export interface CreateCategoryInput {
  bookId: string;
  name: string;
  parentId: string | null;
  kind: 'asset' | 'debt' | 'group';
  currency: CurrencyCode;
}

export async function createCategory(
  db: AssetTrackerDb,
  input: CreateCategoryInput
): Promise<Category> {
  const repository = new CategoryRepository(db);
  const existing = await repository.listByBook(input.bookId);
  const normalizedName = input.name.trim();

  if (!normalizedName) {
    throw new Error('Category name is required');
  }

  if (input.parentId) {
    const parent = existing.find((item) => item.id === input.parentId && item.deletedAt === null);

    if (!parent) {
      throw new Error('Parent category does not exist');
    }

    if (parent.currency !== input.currency) {
      throw new Error('Child category currency must match parent category currency');
    }
  }

  if (
    existing.some(
      (item) => item.parentId === input.parentId && item.name === normalizedName && item.deletedAt === null
    )
  ) {
    throw new Error('Category already exists');
  }

  const siblingCount = existing.filter((item) => item.parentId === input.parentId && item.deletedAt === null).length;
  const now = new Date().toISOString();
  const category = categorySchema.parse({
    id: `cat_${crypto.randomUUID()}`,
    bookId: input.bookId,
    parentId: input.parentId,
    name: normalizedName,
    kind: input.kind,
    currency: input.currency,
    sortOrder: siblingCount,
    isArchived: false,
    ...createMetadata(now)
  });

  await repository.put(category);

  return category;
}
