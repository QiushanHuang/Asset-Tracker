import { markDeleted } from '../../shared/utils/entityMetadata';
import { AssetTrackerDb } from '../../storage/db';
import { TransactionRepository } from '../../storage/repositories/transactionRepository';

export interface DeleteTransactionInput {
  bookId: string;
  transactionId: string;
}

export async function deleteTransaction(
  db: AssetTrackerDb,
  input: DeleteTransactionInput
): Promise<void> {
  const repository = new TransactionRepository(db);
  const transaction = await repository.get(input.transactionId);

  if (!transaction || transaction.deletedAt !== null || transaction.bookId !== input.bookId) {
    throw new Error('Transaction does not exist');
  }

  await repository.put({
    ...transaction,
    ...markDeleted(transaction)
  });
}
