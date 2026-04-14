import { AssetTrackerDb } from '../../storage/db';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';
import { TransactionTemplateRepository } from '../../storage/repositories/transactionTemplateRepository';

export interface TransactionTemplateListItem {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  currency: 'CNY' | 'SGD' | 'USD' | 'MYR';
  direction: 'income' | 'expense' | 'transfer' | 'adjustment';
  purpose: string;
  description: string;
}

export async function listTransactionTemplatesForBook(
  db: AssetTrackerDb,
  bookId: string
): Promise<TransactionTemplateListItem[]> {
  const templateRepository = new TransactionTemplateRepository(db);
  const categoryRepository = new CategoryRepository(db);
  const [templates, categories] = await Promise.all([
    templateRepository.listByBook(bookId),
    categoryRepository.listByBook(bookId)
  ]);
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));

  return templates
    .filter((template) => template.deletedAt === null)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((template) => ({
      id: template.id,
      name: template.name,
      categoryId: template.categoryId,
      categoryName: categoryNameById.get(template.categoryId) ?? '未知分类',
      amount: template.amount,
      currency: template.currency,
      direction: template.direction,
      purpose: template.purpose,
      description: template.description
    }));
}
