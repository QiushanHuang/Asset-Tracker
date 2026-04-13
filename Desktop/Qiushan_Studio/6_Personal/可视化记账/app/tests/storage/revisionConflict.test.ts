import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { MonetaryAmount } from '../../src/shared/types/entities';
import { AssetTrackerDb } from '../../src/storage/db';
import { BookRepository } from '../../src/storage/repositories/bookRepository';
import { CategoryRepository } from '../../src/storage/repositories/categoryRepository';
import { TransactionRepository } from '../../src/storage/repositories/transactionRepository';

describe('CategoryRepository', () => {
  let db: AssetTrackerDb;
  let repository: CategoryRepository;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-revision-test');
    await db.delete();
    await db.open();
    repository = new CategoryRepository(db);
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('rejects stale revisions', async () => {
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

    await expect(
      repository.put({
        id: 'cat_001',
        bookId: 'book_local',
        parentId: null,
        name: '银行卡-旧写入',
        kind: 'group',
        currency: 'CNY',
        sortOrder: 0,
        isArchived: false,
        revision: 1,
        deletedAt: null,
        updatedBy: 'local-user',
        deviceId: 'device_local',
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:01.000Z'
      })
    ).rejects.toThrow('Revision conflict');
  });

  it('rejects concurrent writes from separate connections that reuse the same next revision', async () => {
    const dbName = `asset-tracker-db-category-race-${crypto.randomUUID()}`;
    const writerDbA = new AssetTrackerDb(dbName);
    const writerDbB = new AssetTrackerDb(dbName);

    await writerDbA.delete();
    await writerDbA.open();
    await writerDbB.open();

    const writerA = new CategoryRepository(writerDbA);
    const writerB = new CategoryRepository(writerDbB);

    await writerA.put({
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

    const results = await Promise.allSettled([
      writerA.put({
        id: 'cat_001',
        bookId: 'book_local',
        parentId: null,
        name: '银行卡-A',
        kind: 'group',
        currency: 'CNY',
        sortOrder: 0,
        isArchived: false,
        revision: 2,
        deletedAt: null,
        updatedBy: 'local-user',
        deviceId: 'device_local',
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:01.000Z'
      }),
      writerB.put({
        id: 'cat_001',
        bookId: 'book_local',
        parentId: null,
        name: '银行卡-B',
        kind: 'group',
        currency: 'CNY',
        sortOrder: 0,
        isArchived: false,
        revision: 2,
        deletedAt: null,
        updatedBy: 'local-user',
        deviceId: 'device_local',
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:02.000Z'
      })
    ]);

    writerDbA.close();
    writerDbB.close();
    await writerDbA.delete();

    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});

describe('BookRepository', () => {
  let db: AssetTrackerDb;
  let repository: BookRepository;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-book-revision-test');
    await db.delete();
    await db.open();
    repository = new BookRepository(db);
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('rejects stale revisions', async () => {
    await repository.put({
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

    await expect(
      repository.put({
        id: 'book_local',
        name: '默认账本-旧写入',
        type: 'private',
        baseCurrency: 'CNY',
        revision: 1,
        deletedAt: null,
        updatedBy: 'local-user',
        deviceId: 'device_local',
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:01.000Z'
      })
    ).rejects.toThrow('Revision conflict');
  });
});

describe('TransactionRepository', () => {
  let db: AssetTrackerDb;
  let repository: TransactionRepository;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-transaction-revision-test');
    await db.delete();
    await db.open();
    repository = new TransactionRepository(db);
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('rejects stale revisions', async () => {
    await repository.put({
      id: 'txn_001',
      bookId: 'book_local',
      categoryId: 'cat_001',
      amount: 2050 as MonetaryAmount,
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

    await expect(
      repository.put({
        id: 'txn_001',
        bookId: 'book_local',
        categoryId: 'cat_001',
        amount: 2050 as MonetaryAmount,
        currency: 'CNY',
        direction: 'expense',
        purpose: '餐饮',
        description: '午饭-旧写入',
        occurredAt: '2026-04-13T00:00:00.000Z',
        revision: 1,
        deletedAt: null,
        updatedBy: 'local-user',
        deviceId: 'device_local',
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:01.000Z'
      })
    ).rejects.toThrow('Revision conflict');
  });

  it('rejects concurrent writes from separate connections that reuse the same next revision', async () => {
    const dbName = `asset-tracker-db-transaction-race-${crypto.randomUUID()}`;
    const writerDbA = new AssetTrackerDb(dbName);
    const writerDbB = new AssetTrackerDb(dbName);

    await writerDbA.delete();
    await writerDbA.open();
    await writerDbB.open();

    const writerA = new TransactionRepository(writerDbA);
    const writerB = new TransactionRepository(writerDbB);

    await writerA.put({
      id: 'txn_001',
      bookId: 'book_local',
      categoryId: 'cat_001',
      amount: 2050 as MonetaryAmount,
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

    const results = await Promise.allSettled([
      writerA.put({
        id: 'txn_001',
        bookId: 'book_local',
        categoryId: 'cat_001',
        amount: 2050 as MonetaryAmount,
        currency: 'CNY',
        direction: 'expense',
        purpose: '餐饮',
        description: '午饭-A',
        occurredAt: '2026-04-13T00:00:00.000Z',
        revision: 2,
        deletedAt: null,
        updatedBy: 'local-user',
        deviceId: 'device_local',
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:01.000Z'
      }),
      writerB.put({
        id: 'txn_001',
        bookId: 'book_local',
        categoryId: 'cat_001',
        amount: 2050 as MonetaryAmount,
        currency: 'CNY',
        direction: 'expense',
        purpose: '餐饮',
        description: '午饭-B',
        occurredAt: '2026-04-13T00:00:00.000Z',
        revision: 2,
        deletedAt: null,
        updatedBy: 'local-user',
        deviceId: 'device_local',
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:02.000Z'
      })
    ]);

    writerDbA.close();
    writerDbB.close();
    await writerDbA.delete();

    expect(results.filter((result) => result.status === 'rejected')).toHaveLength(1);
  });
});
