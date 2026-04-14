import type { CurrencyCode, Transaction, TransactionDirection } from '../../shared/types/entities';
import { transactionSchema } from '../../shared/validation/schemas';
import { bumpMetadata } from '../../shared/utils/entityMetadata';
import { toMinorUnits } from '../../shared/utils/money';
import { AssetTrackerDb } from '../../storage/db';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';
import { TransactionRepository } from '../../storage/repositories/transactionRepository';
import { normalizeTransactionAmount } from './createTransaction';

export interface UpdateTransactionInput {
  bookId: string;
  transactionId: string;
  categoryId: string;
  amount: number;
  currency: CurrencyCode;
  direction: TransactionDirection;
  purpose: string;
  description: string;
  occurredAt: string;
}

export async function updateTransaction(
  db: AssetTrackerDb,
  input: UpdateTransactionInput
): Promise<Transaction> {
  const transactionRepository = new TransactionRepository(db);
  const categoryRepository = new CategoryRepository(db);
  const [transaction, categories] = await Promise.all([
    transactionRepository.get(input.transactionId),
    categoryRepository.listByBook(input.bookId)
  ]);

  if (!transaction || transaction.deletedAt !== null) {
    throw new Error('Transaction does not exist');
  }

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

  const now = new Date().toISOString();
  const updated = transactionSchema.parse({
    ...transaction,
    categoryId: input.categoryId,
    amount: toMinorUnits(normalizeTransactionAmount(input.amount, input.direction)),
    currency: input.currency,
    direction: input.direction,
    purpose: input.purpose.trim(),
    description: input.description.trim(),
    occurredAt: input.occurredAt,
    ...bumpMetadata(transaction, now)
  });

  await transactionRepository.put(updated);

  return updated;
}
