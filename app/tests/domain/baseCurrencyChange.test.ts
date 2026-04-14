import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { exportBookSnapshot } from '../../src/domain/importExport/exportBookSnapshot';
import { listExchangeRatesForBook } from '../../src/domain/settings/listExchangeRatesForBook';
import { updateBookBaseCurrency } from '../../src/domain/settings/updateBookBaseCurrency';
import { upsertExchangeRate } from '../../src/domain/settings/upsertExchangeRate';
import { AssetTrackerDb } from '../../src/storage/db';

describe('base currency changes', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-base-currency-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('retires existing exchange rates when the book base currency changes', async () => {
    const book = await loadOrCreateLocalBook(db);

    await upsertExchangeRate(db, {
      bookId: book.id,
      currency: 'USD',
      baseCurrency: 'CNY',
      rate: 7.2
    });

    await updateBookBaseCurrency(db, {
      bookId: book.id,
      baseCurrency: 'USD'
    });

    expect(await listExchangeRatesForBook(db, book.id)).toEqual([]);

    const snapshot = JSON.parse(await exportBookSnapshot(db, book.id)) as {
      book: { baseCurrency: string };
      exchangeRates: unknown[];
    };

    expect(snapshot.book.baseCurrency).toBe('USD');
    expect(snapshot.exchangeRates).toEqual([]);
  });

  it('allows recreating a retired exchange rate under the new base currency', async () => {
    const book = await loadOrCreateLocalBook(db);

    await upsertExchangeRate(db, {
      bookId: book.id,
      currency: 'SGD',
      baseCurrency: 'CNY',
      rate: 5.3
    });

    await updateBookBaseCurrency(db, {
      bookId: book.id,
      baseCurrency: 'USD'
    });

    await upsertExchangeRate(db, {
      bookId: book.id,
      currency: 'SGD',
      baseCurrency: 'USD',
      rate: 0.74
    });

    expect(await listExchangeRatesForBook(db, book.id)).toEqual([
      expect.objectContaining({
        currency: 'SGD',
        baseCurrency: 'USD',
        rate: 0.74,
        deletedAt: null
      })
    ]);
  });
});
