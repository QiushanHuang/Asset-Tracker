import { markDeleted } from '../../shared/utils/entityMetadata';
import { AssetTrackerDb } from '../../storage/db';
import { AssetStateAnchorRepository } from '../../storage/repositories/assetStateAnchorRepository';
import { AutomationRuleRepository } from '../../storage/repositories/automationRuleRepository';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';
import { TransactionTemplateRepository } from '../../storage/repositories/transactionTemplateRepository';
import { TransactionRepository } from '../../storage/repositories/transactionRepository';

export interface DeleteCategoryInput {
  bookId: string;
  categoryId: string;
}

function collectCategoryIds(categoryId: string, childrenByParent: Map<string | null, string[]>): string[] {
  const directChildren = childrenByParent.get(categoryId) ?? [];

  return [categoryId, ...directChildren.flatMap((childId) => collectCategoryIds(childId, childrenByParent))];
}

export async function deleteCategory(
  db: AssetTrackerDb,
  input: DeleteCategoryInput
): Promise<{
  deletedCategoryIds: string[];
  deletedTransactionIds: string[];
  deletedTemplateIds: string[];
  deletedRuleIds: string[];
  deletedAnchorIds: string[];
}> {
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
  const activeCategories = categories.filter((category) => category.deletedAt === null);
  const target = activeCategories.find((category) => category.id === input.categoryId);

  if (!target) {
    throw new Error('Category does not exist');
  }

  const childrenByParent = new Map<string | null, string[]>();

  activeCategories.forEach((category) => {
    const siblings = childrenByParent.get(category.parentId) ?? [];
    siblings.push(category.id);
    childrenByParent.set(category.parentId, siblings);
  });

  const categoryIds = new Set(collectCategoryIds(target.id, childrenByParent));
  const now = new Date().toISOString();
  const deletedCategories = activeCategories
    .filter((category) => categoryIds.has(category.id))
    .map((category) => ({
      ...category,
      ...markDeleted(category, now)
    }));
  const deletedTransactions = transactions
    .filter((transaction) => categoryIds.has(transaction.categoryId) && transaction.deletedAt === null)
    .map((transaction) => ({
      ...transaction,
      ...markDeleted(transaction, now)
    }));
  const deletedTemplates = templates
    .filter((template) => categoryIds.has(template.categoryId) && template.deletedAt === null)
    .map((template) => ({
      ...template,
      ...markDeleted(template, now)
    }));
  const deletedRules = rules
    .filter((rule) => categoryIds.has(rule.categoryId) && rule.deletedAt === null)
    .map((rule) => ({
      ...rule,
      ...markDeleted(rule, now)
    }));
  const deletedAnchors = anchors
    .filter((anchor) => categoryIds.has(anchor.categoryId) && anchor.deletedAt === null)
    .map((anchor) => ({
      ...anchor,
      ...markDeleted(anchor, now)
    }));

  await Promise.all([
    categoryRepository.putMany(deletedCategories),
    deletedTransactions.length > 0 ? transactionRepository.putMany(deletedTransactions) : Promise.resolve(),
    deletedTemplates.length > 0 ? templateRepository.putMany(deletedTemplates) : Promise.resolve(),
    deletedRules.length > 0 ? ruleRepository.putMany(deletedRules) : Promise.resolve(),
    deletedAnchors.length > 0 ? anchorRepository.putMany(deletedAnchors) : Promise.resolve()
  ]);

  return {
    deletedCategoryIds: deletedCategories.map((category) => category.id),
    deletedTransactionIds: deletedTransactions.map((transaction) => transaction.id),
    deletedTemplateIds: deletedTemplates.map((template) => template.id),
    deletedRuleIds: deletedRules.map((rule) => rule.id),
    deletedAnchorIds: deletedAnchors.map((anchor) => anchor.id)
  };
}
