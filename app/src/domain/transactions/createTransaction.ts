import type { CurrencyCode, Transaction, TransactionDirection } from '../../shared/types/entities';
import { transactionSchema } from '../../shared/validation/schemas';
import { createMetadata } from '../../shared/utils/entityMetadata';
import { toMinorUnits } from '../../shared/utils/money';
import { AssetTrackerDb } from '../../storage/db';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';
import { TransactionRepository } from '../../storage/repositories/transactionRepository';

export interface CreateTransactionInput {
  bookId: string;
  categoryId: string;
  amount: number;
  currency: CurrencyCode;
  direction: TransactionDirection;
  purpose: string;
  description: string;
  occurredAt: string;
  automationRuleId?: string | null;
  automationOccurrenceDate?: string | null;
}

export function normalizeTransactionAmount(
  amount: number,
  direction: CreateTransactionInput['direction']
): number {
  if (direction === 'income') {
    return Math.abs(amount);
  }

  if (direction === 'expense') {
    return Math.abs(amount) * -1;
  }

  return amount;
}

export async function createTransaction(
  db: AssetTrackerDb,
  input: CreateTransactionInput
): Promise<Transaction> {
  const categoryRepository = new CategoryRepository(db);
  const categories = await categoryRepository.listByBook(input.bookId);
  const category = categories.find((item) => item.id === input.categoryId && item.deletedAt === null);

  if (!category) {
    throw new Error('Category does not exist');
  }

  if (category.kind === 'group') {
    throw new Error('Cannot attach transactions to a group category');
  }

  if (category.currency !== input.currency) {
    throw new Error('Transaction currency must match category currency');
  }

  const repository = new TransactionRepository(db);
  const now = new Date().toISOString();
  const transaction = transactionSchema.parse({
    id: `txn_${crypto.randomUUID()}`,
    bookId: input.bookId,
    categoryId: input.categoryId,
    amount: toMinorUnits(normalizeTransactionAmount(input.amount, input.direction)),
    currency: input.currency,
    direction: input.direction,
    purpose: input.purpose.trim(),
    description: input.description.trim(),
    occurredAt: input.occurredAt,
    automationRuleId: input.automationRuleId ?? null,
    automationOccurrenceDate: input.automationOccurrenceDate ?? null,
    ...createMetadata(now)
  });

  await repository.put(transaction);

  return transaction;
}
