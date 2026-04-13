import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetTrackerDb } from '../../src/storage/db';
import { BookRepository } from '../../src/storage/repositories/bookRepository';
import { CategoryRepository } from '../../src/storage/repositories/categoryRepository';
import { TransactionRepository } from '../../src/storage/repositories/transactionRepository';

describe('repository contracts', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-contract-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('returns the inserted book key and records a book operation log entry', async () => {
    const repository = new BookRepository(db);

    const key = await repository.put({
      id: 'book_local',
      name: '默认账本',
      type: 'private',
      baseCurrency: 'CNY',
      revision: 1,
      deletedAt: null,
      updatedBy: 'local-user',
      deviceId: 'device_local',
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z'
    });

    expect(key).toBe('book_local');
    expect((await db.operations.toArray())[0]?.id).toBe('op_book_local_1');
  });

  it('uses the planned category operation id format', async () => {
    const repository = new CategoryRepository(db);

    await repository.put({
      id: 'cat_001',
      bookId: 'book_local',
      parentId: null,
      name: '银行卡',
      kind: 'group',
      currency: 'CNY',
      sortOrder: 0,
      isArchived: false,
      revision: 1,
      deletedAt: null,
      updatedBy: 'local-user',
      deviceId: 'device_local',
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z'
    });

    expect((await db.operations.toArray())[0]?.id).toBe('op_cat_001_1');
  });

  it('uses the planned transaction operation id format', async () => {
    const repository = new TransactionRepository(db);

    await repository.put({
      id: 'txn_001',
      bookId: 'book_local',
      categoryId: 'cat_001',
      amount: 2050 as never,
      currency: 'CNY',
      direction: 'expense',
      purpose: '餐饮',
      description: '午饭',
      occurredAt: '2026-04-13T00:00:00.000Z',
      revision: 1,
      deletedAt: null,
      updatedBy: 'local-user',
      deviceId: 'device_local',
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z'
    });

    expect((await db.operations.toArray())[0]?.id).toBe('op_txn_001_1');
  });
});
