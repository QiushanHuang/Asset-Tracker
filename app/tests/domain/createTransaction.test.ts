import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { AssetTrackerDb } from '../../src/storage/db';

describe('createTransaction', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-create-transaction');
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('stores expense transactions as negative minor-unit amounts', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '支付宝',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    const transaction = await createTransaction(db, {
      bookId: book.id,
      categoryId: category.id,
      amount: 25.5,
      currency: 'CNY',
      direction: 'expense',
      purpose: '餐饮',
      description: '午饭',
      occurredAt: '2026-04-13T12:00:00.000Z'
    });

    expect(transaction.amount).toBe(-2550);
    expect((await db.transactions.toArray())[0]?.amount).toBe(-2550);
  });

  it('rejects transactions whose currency does not match the category currency', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: 'Singapore Cash',
      parentId: null,
      kind: 'asset',
      currency: 'SGD'
    });

    await expect(
      createTransaction(db, {
        bookId: book.id,
        categoryId: category.id,
        amount: 10,
        currency: 'CNY',
        direction: 'income',
        purpose: '错误币种',
        description: 'should fail',
        occurredAt: '2026-04-13T12:00:00.000Z'
      })
    ).rejects.toThrow('Transaction currency must match category currency');
  });
});
