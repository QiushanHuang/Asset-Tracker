import type { Transaction } from '../../shared/types/entities';
import { AssetTrackerDb } from '../../storage/db';
import { TransactionTemplateRepository } from '../../storage/repositories/transactionTemplateRepository';
import { createTransaction } from '../transactions/createTransaction';

export interface ApplyTransactionTemplateInput {
  bookId: string;
  templateId: string;
  occurredAt: string;
}

export async function applyTransactionTemplate(
  db: AssetTrackerDb,
  input: ApplyTransactionTemplateInput
): Promise<Transaction> {
  const repository = new TransactionTemplateRepository(db);
  const template = await repository.get(input.templateId);

  if (!template || template.bookId !== input.bookId || template.deletedAt !== null) {
    throw new Error('Template does not exist');
  }

  return createTransaction(db, {
    bookId: input.bookId,
    categoryId: template.categoryId,
    amount: template.amount / 100,
    currency: template.currency,
    direction: template.direction,
    purpose: template.purpose,
    description: template.description,
    occurredAt: input.occurredAt
  });
}
