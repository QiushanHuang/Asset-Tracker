import { categorySchema } from '../../shared/validation/schemas';
import { bumpMetadata } from '../../shared/utils/entityMetadata';
import { AssetTrackerDb } from '../../storage/db';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';

export interface MoveCategoryInput {
  bookId: string;
  categoryId: string;
  targetParentId: string | null;
  targetIndex: number;
}

function sortSiblings<T extends { sortOrder: number; createdAt: string }>(siblings: T[]): T[] {
  return [...siblings].sort(
    (left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt)
  );
}

function isDescendantOf(
  categoryId: string,
  targetParentId: string | null,
  parentById: Map<string, string | null>
): boolean {
  let cursor = targetParentId;

  while (cursor) {
    if (cursor === categoryId) {
      return true;
    }

    cursor = parentById.get(cursor) ?? null;
  }

  return false;
}

function collectSubtreeIds(
  categoryId: string,
  childrenByParent: Map<string | null, Array<{ id: string }>>
): string[] {
  const children = childrenByParent.get(categoryId) ?? [];

  return [categoryId, ...children.flatMap((child) => collectSubtreeIds(child.id, childrenByParent))];
}

export async function moveCategory(
  db: AssetTrackerDb,
  input: MoveCategoryInput
): Promise<void> {
  const repository = new CategoryRepository(db);
  const categories = (await repository.listByBook(input.bookId)).filter((category) => category.deletedAt === null);
  const movingCategory = categories.find((category) => category.id === input.categoryId);

  if (!movingCategory) {
    throw new Error('Category does not exist');
  }

  const targetParent = input.targetParentId
    ? categories.find((category) => category.id === input.targetParentId)
    : undefined;

  if (input.targetParentId && !targetParent) {
    throw new Error('Target parent category does not exist');
  }

  const parentById = new Map(categories.map((category) => [category.id, category.parentId]));
  const childrenByParent = new Map<string | null, typeof categories>();

  for (const category of categories) {
    const siblings = childrenByParent.get(category.parentId) ?? [];
    siblings.push(category);
    childrenByParent.set(category.parentId, siblings);
  }

  if (isDescendantOf(movingCategory.id, input.targetParentId, parentById)) {
    throw new Error('Cannot move a category into its own descendant');
  }

  if (targetParent) {
    const subtreeIds = new Set(collectSubtreeIds(movingCategory.id, childrenByParent));
    const subtreeCurrencies = categories
      .filter((category) => subtreeIds.has(category.id))
      .map((category) => category.currency);

    if (subtreeCurrencies.some((currency) => currency !== targetParent.currency)) {
      throw new Error('Category currency must match target parent currency');
    }
  }

  const now = new Date().toISOString();
  const oldParentId = movingCategory.parentId;
  const oldSiblings = sortSiblings(
    categories.filter((category) => category.parentId === oldParentId && category.id !== movingCategory.id)
  );
  const destinationSiblings = sortSiblings(
    categories.filter((category) => category.parentId === input.targetParentId && category.id !== movingCategory.id)
  );
  const boundedIndex = Math.max(0, Math.min(input.targetIndex, destinationSiblings.length));
  const insertedCategory = categorySchema.parse({
    ...movingCategory,
    parentId: input.targetParentId,
    ...bumpMetadata(movingCategory, now)
  });
  destinationSiblings.splice(boundedIndex, 0, insertedCategory);

  const updatedCategories = new Map<string, ReturnType<typeof categorySchema.parse>>();
  const rewriteSiblingList = (siblings: typeof destinationSiblings): void => {
    siblings.forEach((category, index) => {
      if (category.sortOrder === index && updatedCategories.has(category.id)) {
        return;
      }

      updatedCategories.set(
        category.id,
        categorySchema.parse({
          ...category,
          sortOrder: index,
          ...(category.id === insertedCategory.id ? {} : bumpMetadata(category, now))
        })
      );
    });
  };

  rewriteSiblingList(destinationSiblings);

  if (oldParentId !== input.targetParentId) {
    rewriteSiblingList(oldSiblings);
  }

  await repository.putMany([...updatedCategories.values()]);
}
