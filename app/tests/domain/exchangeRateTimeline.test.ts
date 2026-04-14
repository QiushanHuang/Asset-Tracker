import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { calculateBookSummaryAt } from '../../src/domain/dashboard/calculateBookSummaryAt';
import { listExchangeRatesForBook } from '../../src/domain/settings/listExchangeRatesForBook';
import { upsertExchangeRate } from '../../src/domain/settings/upsertExchangeRate';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { AssetTrackerDb } from '../../src/storage/db';

describe('exchange rate timeline', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-fx-timeline-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('uses the latest effective rate on or before each summary date', async () => {
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
      amount: 100,
      currency: 'USD',
      direction: 'income',
      purpose: '美元入账',
      description: '',
      occurredAt: '2026-04-05T10:00:00.000Z'
    });
    await upsertExchangeRate(db, {
      bookId: book.id,
      currency: 'USD',
      baseCurrency: 'CNY',
      rate: 10,
      effectiveFrom: '2026-04-01'
    });
    await upsertExchangeRate(db, {
      bookId: book.id,
      currency: 'USD',
      baseCurrency: 'CNY',
      rate: 12,
      effectiveFrom: '2026-04-07'
    });

    const earlySummary = await calculateBookSummaryAt(db, book.id, '2026-04-05T12:00:00.000Z');
    const lateSummary = await calculateBookSummaryAt(db, book.id, '2026-04-08T12:00:00.000Z');

    expect(earlySummary.assetAmount).toBe(100000);
    expect(earlySummary.unresolvedCurrencies).toEqual([]);
    expect(lateSummary.assetAmount).toBe(120000);
    expect(lateSummary.unresolvedCurrencies).toEqual([]);
  });

  it('treats the latest configured rate as the default for future dates and updates same-day entries', async () => {
    const book = await loadOrCreateLocalBook(db);

    await upsertExchangeRate(db, {
      bookId: book.id,
      currency: 'USD',
      baseCurrency: 'CNY',
      rate: 10,
      effectiveFrom: '2026-04-01'
    });
    await upsertExchangeRate(db, {
      bookId: book.id,
      currency: 'USD',
      baseCurrency: 'CNY',
      rate: 11,
      effectiveFrom: '2026-04-14'
    });
    await upsertExchangeRate(db, {
      bookId: book.id,
      currency: 'USD',
      baseCurrency: 'CNY',
      rate: 11.2,
      effectiveFrom: '2026-04-14'
    });

    const exchangeRates = await listExchangeRatesForBook(db, book.id);

    expect(exchangeRates).toEqual([
      expect.objectContaining({
        currency: 'USD',
        rate: 11.2,
        effectiveFrom: '2026-04-14'
      })
    ]);
  });
});
