import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { listTransactionsForBook } from '../../src/domain/transactions/listTransactionsForBook';
import { AssetTrackerDb } from '../../src/storage/db';

describe('transaction filtering', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-transaction-filter-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('filters by year, month, category, purpose, direction, and sorts by amount descending', async () => {
    const book = await loadOrCreateLocalBook(db);
    const cash = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const card = await createCategory(db, {
      bookId: book.id,
      name: '信用卡',
      parentId: null,
      kind: 'debt',
      currency: 'CNY'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 5000,
      currency: 'CNY',
      direction: 'income',
      purpose: '工资',
      description: '',
      occurredAt: '2026-04-15T09:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 3000,
      currency: 'CNY',
      direction: 'income',
      purpose: '工资奖金',
      description: '',
      occurredAt: '2026-04-20T09:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 200,
      currency: 'CNY',
      direction: 'expense',
      purpose: '早餐',
      description: '',
      occurredAt: '2026-04-20T07:30:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: card.id,
      amount: 1200,
      currency: 'CNY',
      direction: 'expense',
      purpose: '购物',
      description: '',
      occurredAt: '2025-04-20T07:30:00.000Z'
    });

    const filtered = await listTransactionsForBook(db, book.id, {
      year: '2026',
      month: '04',
      categoryId: cash.id,
      purpose: '工资',
      direction: 'income',
      sortBy: 'amount-desc'
    });

    expect(filtered.map((item) => item.purpose)).toEqual(['工资', '工资奖金']);
    expect(filtered.map((item) => item.amount)).toEqual([500000, 300000]);
  });

  it('supports exact date filtering and amount ascending sort', async () => {
    const book = await loadOrCreateLocalBook(db);
    const cash = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 88,
      currency: 'CNY',
      direction: 'expense',
      purpose: '午餐',
      description: '',
      occurredAt: '2026-04-22T12:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 12,
      currency: 'CNY',
      direction: 'expense',
      purpose: '咖啡',
      description: '',
      occurredAt: '2026-04-22T08:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 200,
      currency: 'CNY',
      direction: 'expense',
      purpose: '晚餐',
      description: '',
      occurredAt: '2026-04-21T10:00:00.000Z'
    });

    const filtered = await listTransactionsForBook(db, book.id, {
      date: '2026-04-22',
      sortBy: 'amount-asc'
    });

    expect(filtered.map((item) => item.purpose)).toEqual(['咖啡', '午餐']);
    expect(filtered.map((item) => item.amount)).toEqual([-1200, -8800]);
  });

  it('applies date filters using the local calendar date instead of raw UTC slices', async () => {
    const book = await loadOrCreateLocalBook(db);
    const cash = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 50,
      currency: 'CNY',
      direction: 'expense',
      purpose: '深夜外卖',
      description: '',
      occurredAt: '2026-04-21T16:30:00.000Z'
    });

    const filtered = await listTransactionsForBook(db, book.id, {
      date: '2026-04-22'
    });

    expect(filtered.map((item) => item.purpose)).toEqual(['深夜外卖']);
  });
});
