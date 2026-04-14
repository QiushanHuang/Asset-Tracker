import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { calculateBookSummary } from '../../src/domain/dashboard/calculateBookSummary';
import { createCategory } from '../../src/domain/categories/createCategory';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { AssetTrackerDb } from '../../src/storage/db';

describe('calculateBookSummary', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-summary');
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('aggregates asset and debt balances from stored transactions', async () => {
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
      amount: 100,
      currency: 'CNY',
      direction: 'income',
      purpose: '初始化',
      description: '现金充值',
      occurredAt: '2026-04-13T09:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: card.id,
      amount: 40,
      currency: 'CNY',
      direction: 'expense',
      purpose: '购物',
      description: '刷卡',
      occurredAt: '2026-04-13T10:00:00.000Z'
    });

    const summary = await calculateBookSummary(db, book.id);

    expect(summary.netAmount).toBe(6000);
    expect(summary.assetAmount).toBe(10000);
    expect(summary.debtAmount).toBe(4000);
    expect(summary.transactionCount).toBe(2);
  });

  it('treats positive balances on debt accounts as credits instead of debt', async () => {
    const book = await loadOrCreateLocalBook(db);
    const card = await createCategory(db, {
      bookId: book.id,
      name: '信用卡',
      parentId: null,
      kind: 'debt',
      currency: 'CNY'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: card.id,
      amount: 25,
      currency: 'CNY',
      direction: 'income',
      purpose: '退款',
      description: '多还款返还',
      occurredAt: '2026-04-13T10:00:00.000Z'
    });

    const summary = await calculateBookSummary(db, book.id);

    expect(summary.assetAmount).toBe(2500);
    expect(summary.debtAmount).toBe(0);
    expect(summary.netAmount).toBe(2500);
  });

  it('does not mix unresolved foreign currencies into the base-currency summary', async () => {
    const book = await loadOrCreateLocalBook(db);
    const foreignCash = await createCategory(db, {
      bookId: book.id,
      name: '新币现金',
      parentId: null,
      kind: 'asset',
      currency: 'SGD'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: foreignCash.id,
      amount: 10,
      currency: 'SGD',
      direction: 'income',
      purpose: '初始资金',
      description: 'foreign income',
      occurredAt: '2026-04-13T10:00:00.000Z'
    });

    const summary = await calculateBookSummary(db, book.id);

    expect(summary.assetAmount).toBe(0);
    expect(summary.netAmount).toBe(0);
    expect(summary.unresolvedCurrencies).toEqual(['SGD']);
  });
});
