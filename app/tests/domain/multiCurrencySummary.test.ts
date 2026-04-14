import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { calculateBookSummary } from '../../src/domain/dashboard/calculateBookSummary';
import { upsertExchangeRate } from '../../src/domain/settings/upsertExchangeRate';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { AssetTrackerDb } from '../../src/storage/db';

describe('multi-currency summary', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-summary-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('converts foreign balances into the book base currency when rates exist', async () => {
    const book = await loadOrCreateLocalBook(db);
    const cash = await createCategory(db, {
      bookId: book.id,
      name: '人民币账户',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const usd = await createCategory(db, {
      bookId: book.id,
      name: '美元账户',
      parentId: null,
      kind: 'asset',
      currency: 'USD'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 100,
      currency: 'CNY',
      direction: 'income',
      purpose: '人民币入账',
      description: '',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: usd.id,
      amount: 50,
      currency: 'USD',
      direction: 'income',
      purpose: '美元入账',
      description: '',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });
    await upsertExchangeRate(db, {
      bookId: book.id,
      currency: 'USD',
      baseCurrency: 'CNY',
      rate: 7.2
    });

    const summary = await calculateBookSummary(db, book.id);

    expect(summary.assetAmount).toBe(46000);
    expect(summary.netAmount).toBe(46000);
    expect(summary.unresolvedCurrencies).toEqual([]);
    expect(summary.currencyBreakdown).toEqual(
      expect.arrayContaining([
        expect.objectContaining({ currency: 'CNY', netAmount: 10000, convertedNetAmount: 10000 }),
        expect.objectContaining({ currency: 'USD', netAmount: 5000, convertedNetAmount: 36000 })
      ])
    );
  });

  it('reports unresolved currencies when no exchange rate is configured', async () => {
    const book = await loadOrCreateLocalBook(db);
    const usd = await createCategory(db, {
      bookId: book.id,
      name: '美元账户',
      parentId: null,
      kind: 'asset',
      currency: 'USD'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: usd.id,
      amount: 50,
      currency: 'USD',
      direction: 'income',
      purpose: '美元入账',
      description: '',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });

    const summary = await calculateBookSummary(db, book.id);

    expect(summary.assetAmount).toBe(0);
    expect(summary.unresolvedCurrencies).toEqual(['USD']);
  });
});
