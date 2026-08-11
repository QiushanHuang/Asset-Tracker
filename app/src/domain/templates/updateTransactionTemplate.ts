import type {
  CurrencyCode,
  TransactionDirection,
  TransactionTemplate
} from '../../shared/types/entities';
import { transactionTemplateSchema } from '../../shared/validation/schemas';
import { bumpMetadata } from '../../shared/utils/entityMetadata';
import { toMinorUnits } from '../../shared/utils/money';
import { AssetTrackerDb } from '../../storage/db';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';
import { TransactionTemplateRepository } from '../../storage/repositories/transactionTemplateRepository';
import { normalizeTransactionAmount } from '../transactions/createTransaction';

export interface UpdateTransactionTemplateInput {
  bookId: string;
  templateId: string;
  name: string;
  categoryId: string;
  amount: number;
  currency: CurrencyCode;
  direction: TransactionDirection;
  purpose: string;
  description: string;
}

export async function updateTransactionTemplate(
  db: AssetTrackerDb,
  input: UpdateTransactionTemplateInput
): Promise<TransactionTemplate> {
  const templateRepository = new TransactionTemplateRepository(db);
  const categoryRepository = new CategoryRepository(db);
  const [template, templates, categories] = await Promise.all([
    templateRepository.get(input.templateId),
    templateRepository.listByBook(input.bookId),
    categoryRepository.listByBook(input.bookId)
  ]);

  if (!template || template.deletedAt !== null) {
    throw new Error('Template does not exist');
  }

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

  if (
    templates.some(
      (item) => item.id !== template.id && item.deletedAt === null && item.name === normalizedName
    )
  ) {
    throw new Error('Template already exists');
  }

  const now = new Date().toISOString();
  const updated = transactionTemplateSchema.parse({
    ...template,
    name: normalizedName,
    categoryId: input.categoryId,
    amount: toMinorUnits(normalizeTransactionAmount(input.amount, input.direction)),
    currency: input.currency,
    direction: input.direction,
    purpose: input.purpose.trim(),
    description: input.description.trim(),
    ...bumpMetadata(template, now)
  });

  await templateRepository.put(updated);

  return updated;
}
