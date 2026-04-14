import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { deleteTransaction } from '../../src/domain/transactions/deleteTransaction';
import { listTransactionsForBook } from '../../src/domain/transactions/listTransactionsForBook';
import { updateTransaction } from '../../src/domain/transactions/updateTransaction';
import { AssetTrackerDb } from '../../src/storage/db';
import { TransactionRepository } from '../../src/storage/repositories/transactionRepository';

describe('transaction lifecycle', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-transaction-lifecycle-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('updates a transaction and keeps minor units normalized', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const transaction = await createTransaction(db, {
      bookId: book.id,
      categoryId: category.id,
      amount: 88.5,
      currency: 'CNY',
      direction: 'income',
      purpose: '初始化',
      description: '启动资金',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });

    const updated = await updateTransaction(db, {
      bookId: book.id,
      transactionId: transaction.id,
      categoryId: category.id,
      amount: 66.25,
      currency: 'CNY',
      direction: 'expense',
      purpose: '采购',
      description: '买菜',
      occurredAt: '2026-04-14T00:00:00.000Z'
    });

    expect(updated.amount).toBe(-6625);
    expect(updated.purpose).toBe('采购');
    expect(updated.revision).toBe(2);
  });

  it('soft deletes a transaction so it disappears from active lists', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const transaction = await createTransaction(db, {
      bookId: book.id,
      categoryId: category.id,
      amount: 100,
      currency: 'CNY',
      direction: 'income',
      purpose: '初始化',
      description: '启动资金',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });

    await deleteTransaction(db, {
      bookId: book.id,
      transactionId: transaction.id
    });

    expect(await listTransactionsForBook(db, book.id)).toEqual([]);
    const stored = await new TransactionRepository(db).listByBook(book.id);
    expect(stored[0]?.deletedAt).not.toBeNull();
  });
});
