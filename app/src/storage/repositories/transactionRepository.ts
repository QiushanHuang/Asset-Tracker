import type { Transaction } from '../../shared/types/entities';
import type { OperationLogEntry } from '../db';
import { AssetTrackerDb } from '../db';

function buildPutOperation(transaction: Transaction): OperationLogEntry {
  return {
    id: `op_${transaction.id}_${transaction.revision}`,
    bookId: transaction.bookId,
    entityType: 'transaction',
    entityId: transaction.id,
    operationType: 'put',
    payload: JSON.stringify(transaction),
    deviceId: transaction.deviceId,
    createdAt: transaction.updatedAt
  };
}

export class TransactionRepository {
  constructor(private readonly db: AssetTrackerDb) {}

  listByBook(bookId: string): Promise<Transaction[]> {
    return this.db.transactions.where('bookId').equals(bookId).sortBy('occurredAt');
  }

  get(transactionId: string): Promise<Transaction | undefined> {
    return this.db.transactions.get(transactionId);
  }

  async put(transaction: Transaction): Promise<void> {
    await this.putMany([transaction]);
  }

  async putMany(transactions: Transaction[]): Promise<void> {
    await this.db.transaction('rw', this.db.transactions, this.db.operations, async () => {
      for (const transaction of transactions) {
        const existing = await this.db.transactions.get(transaction.id);

        if (existing && transaction.revision <= existing.revision) {
          throw new Error('Revision conflict');
        }
      }

      await this.db.transactions.bulkPut(transactions);
      await this.db.operations.bulkPut(transactions.map((transaction) => buildPutOperation(transaction)));
    });
  }
}
