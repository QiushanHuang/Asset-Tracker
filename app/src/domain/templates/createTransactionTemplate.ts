import type {
  CurrencyCode,
  TransactionDirection,
  TransactionTemplate
} from '../../shared/types/entities';
import { transactionTemplateSchema } from '../../shared/validation/schemas';
import { createMetadata } from '../../shared/utils/entityMetadata';
import { toMinorUnits } from '../../shared/utils/money';
import { AssetTrackerDb } from '../../storage/db';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';
import { TransactionTemplateRepository } from '../../storage/repositories/transactionTemplateRepository';
import { normalizeTransactionAmount } from '../transactions/createTransaction';

export interface CreateTransactionTemplateInput {
  bookId: string;
  name: string;
  categoryId: string;
  amount: number;
  currency: CurrencyCode;
  direction: TransactionDirection;
  purpose: string;
  description: string;
}

export async function createTransactionTemplate(
  db: AssetTrackerDb,
  input: CreateTransactionTemplateInput
): Promise<TransactionTemplate> {
  const categoryRepository = new CategoryRepository(db);
  const templateRepository = new TransactionTemplateRepository(db);
  const [categories, templates] = await Promise.all([
    categoryRepository.listByBook(input.bookId),
    templateRepository.listByBook(input.bookId)
  ]);
  const category = categories.find((item) => item.id === input.categoryId && item.deletedAt === null);
  const normalizedName = input.name.trim();

  if (!category) {
    throw new Error('Category does not exist');
  }

  if (category.kind === 'group') {
    throw new Error('Cannot create a template for a group category');
  }

  if (category.currency !== input.currency) {
    throw new Error('Template currency must match category currency');
  }

  if (!normalizedName) {
    throw new Error('Template name is required');
  }

  if (templates.some((item) => item.deletedAt === null && item.name === normalizedName)) {
    throw new Error('Template already exists');
  }

  const now = new Date().toISOString();
  const template = transactionTemplateSchema.parse({
    id: `tpl_${crypto.randomUUID()}`,
    bookId: input.bookId,
    name: normalizedName,
    categoryId: input.categoryId,
    amount: toMinorUnits(normalizeTransactionAmount(input.amount, input.direction)),
    currency: input.currency,
    direction: input.direction,
    purpose: input.purpose.trim(),
    description: input.description.trim(),
    ...createMetadata(now)
  });

  await templateRepository.put(template);

  return template;
}
