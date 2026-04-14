import type { Category, CurrencyCode } from '../../shared/types/entities';
import { categorySchema } from '../../shared/validation/schemas';
import { bumpMetadata } from '../../shared/utils/entityMetadata';
import { AssetTrackerDb } from '../../storage/db';
import { AssetStateAnchorRepository } from '../../storage/repositories/assetStateAnchorRepository';
import { AutomationRuleRepository } from '../../storage/repositories/automationRuleRepository';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';
import { TransactionTemplateRepository } from '../../storage/repositories/transactionTemplateRepository';
import { TransactionRepository } from '../../storage/repositories/transactionRepository';
import { moveCategory } from './moveCategory';

export interface UpdateCategoryInput {
  bookId: string;
  categoryId: string;
  parentId: string | null;
  name: string;
  kind: 'asset' | 'debt' | 'group';
  currency: CurrencyCode;
}

function collectDescendantIds(categoryId: string, categories: Category[]): Set<string> {
  const childrenByParent = new Map<string | null, Category[]>();

  categories.forEach((item) => {
    const siblings = childrenByParent.get(item.parentId) ?? [];
    siblings.push(item);
    childrenByParent.set(item.parentId, siblings);
  });

  const ids = new Set<string>();
  const visit = (parentId: string): void => {
    const children = childrenByParent.get(parentId) ?? [];

    children.forEach((child) => {
      ids.add(child.id);
      visit(child.id);
    });
  };

  visit(categoryId);

  return ids;
}

export async function updateCategory(
  db: AssetTrackerDb,
  input: UpdateCategoryInput
): Promise<Category> {
  const categoryRepository = new CategoryRepository(db);
  const transactionRepository = new TransactionRepository(db);
  const templateRepository = new TransactionTemplateRepository(db);
  const ruleRepository = new AutomationRuleRepository(db);
  const anchorRepository = new AssetStateAnchorRepository(db);
  const [categories, transactions, templates, rules, anchors] = await Promise.all([
    categoryRepository.listByBook(input.bookId),
    transactionRepository.listByBook(input.bookId),
    templateRepository.listByBook(input.bookId),
    ruleRepository.listByBook(input.bookId),
    anchorRepository.listByBook(input.bookId)
  ]);
  const activeCategories = categories.filter((item) => item.deletedAt === null);
  const category = activeCategories.find((item) => item.id === input.categoryId);

  if (!category) {
    throw new Error('Category does not exist');
  }

  const normalizedName = input.name.trim();
  const targetParentId = input.parentId;
  const descendantIds = collectDescendantIds(category.id, activeCategories);
  const descendantCategories = activeCategories.filter((item) => descendantIds.has(item.id));
  const targetParent = targetParentId
    ? activeCategories.find((item) => item.id === targetParentId)
    : undefined;

  if (!normalizedName) {
    throw new Error('Category name is required');
  }

  if (targetParentId && !targetParent) {
    throw new Error('Parent category does not exist');
  }

  if (targetParent && targetParent.currency !== input.currency) {
    throw new Error('Category currency must match target parent currency');
  }

  if (input.currency !== category.currency && descendantCategories.length > 0) {
    throw new Error('Cannot change currency of category with child categories');
  }

  if (descendantCategories.some((item) => item.currency !== input.currency)) {
    throw new Error('Category subtree currency must remain consistent');
  }

  if (
    activeCategories.some(
      (item) =>
        item.id !== category.id &&
        item.parentId === targetParentId &&
        item.name === normalizedName
    )
  ) {
    throw new Error('Category already exists');
  }

  const activeTransactions = transactions.filter(
    (transaction) => transaction.categoryId === category.id && transaction.deletedAt === null
  );
  const activeTemplates = templates.filter(
    (template) => template.categoryId === category.id && template.deletedAt === null
  );
  const activeRules = rules.filter((rule) => rule.categoryId === category.id && rule.deletedAt === null);
  const activeAnchors = anchors.filter((anchor) => anchor.categoryId === category.id && anchor.deletedAt === null);

  if (
    input.kind === 'group' &&
    (activeTransactions.length > 0 || activeTemplates.length > 0 || activeRules.length > 0)
  ) {
    throw new Error('Cannot convert a transacting category into a group');
  }

  if (
    input.currency !== category.currency &&
    (
      activeTransactions.length > 0 ||
      activeTemplates.length > 0 ||
      activeRules.length > 0 ||
      activeAnchors.length > 0
    )
  ) {
    throw new Error('Cannot change category currency when history already exists');
  }

  if (
    input.kind !== category.kind &&
    (activeTransactions.length > 0 || activeAnchors.length > 0)
  ) {
    throw new Error('Cannot change category kind when balance history already exists');
  }

  if (targetParentId !== category.parentId) {
    await moveCategory(db, {
      bookId: input.bookId,
      categoryId: category.id,
      targetParentId,
      targetIndex: activeCategories.filter(
        (item) => item.parentId === targetParentId && item.id !== category.id
      ).length
    });
  }

  const currentCategory =
    targetParentId !== category.parentId ? await categoryRepository.get(category.id) : category;

  if (!currentCategory || currentCategory.deletedAt !== null) {
    throw new Error('Category does not exist');
  }

  if (
    currentCategory.name === normalizedName &&
    currentCategory.kind === input.kind &&
    currentCategory.currency === input.currency &&
    currentCategory.parentId === targetParentId
  ) {
    return currentCategory;
  }

  const now = new Date().toISOString();
  const updated = categorySchema.parse({
    ...currentCategory,
    parentId: targetParentId,
    name: normalizedName,
    kind: input.kind,
    currency: input.currency,
    ...bumpMetadata(currentCategory, now)
  });

  await categoryRepository.put(updated);

  return updated;
}
