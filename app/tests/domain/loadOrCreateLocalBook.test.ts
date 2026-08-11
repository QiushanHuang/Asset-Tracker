import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fixture from '../fixtures/legacy/assetTrackerData.sample.json';
import { AssetTrackerDb } from '../../src/storage/db';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';

describe('loadOrCreateLocalBook', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    localStorage.removeItem('assetTrackerData');
    localStorage.removeItem('assetTrackerLegacyAutoImportCompleted');
    db = new AssetTrackerDb('asset-tracker-db-load-test');
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    localStorage.removeItem('assetTrackerData');
    localStorage.removeItem('assetTrackerLegacyAutoImportCompleted');
    await db.delete();
    db.close();
  });

  it('creates a default local book on first boot', async () => {
    const book = await loadOrCreateLocalBook(db);

    expect(book.id).toBe('book_local');
    expect(book.type).toBe('private');
    expect(book.baseCurrency).toBe('CNY');
  });

  it('returns the same local book when two fresh bootstraps race', async () => {
    const dbName = `asset-tracker-db-load-race-${crypto.randomUUID()}`;
    const firstDb = new AssetTrackerDb(dbName);
    const secondDb = new AssetTrackerDb(dbName);

    await Promise.all([firstDb.open(), secondDb.open()]);

    await expect(
      Promise.all([loadOrCreateLocalBook(firstDb), loadOrCreateLocalBook(secondDb)])
    ).resolves.toEqual([
      expect.objectContaining({ id: 'book_local' }),
      expect.objectContaining({ id: 'book_local' })
    ]);

    expect(await firstDb.books.count()).toBe(1);

    firstDb.close();
    secondDb.close();
    await firstDb.delete();
  });

  it('does not replay the same legacy localStorage payload after a successful auto-import', async () => {
    localStorage.setItem('assetTrackerData', JSON.stringify(fixture));

    const firstBook = await loadOrCreateLocalBook(db);

    expect(firstBook.memo).toBe('legacy memo');
    expect(await db.transactions.count()).toBe(1);

    await db.categories.where('bookId').equals(firstBook.id).delete();
    await db.transactions.where('bookId').equals(firstBook.id).delete();
    await db.transactionTemplates.where('bookId').equals(firstBook.id).delete();
    await db.automationRules.where('bookId').equals(firstBook.id).delete();
    await db.exchangeRates.where('bookId').equals(firstBook.id).delete();
    await db.assetStateAnchors.where('bookId').equals(firstBook.id).delete();

    await loadOrCreateLocalBook(db);

    expect(await db.transactions.count()).toBe(0);
    expect(await db.categories.count()).toBe(0);
  });

  it('returns the repaired imported book in both branches of the first-boot race', async () => {
    localStorage.setItem('assetTrackerData', JSON.stringify(fixture));

    const dbName = `asset-tracker-db-load-race-legacy-${crypto.randomUUID()}`;
    const firstDb = new AssetTrackerDb(dbName);
    const secondDb = new AssetTrackerDb(dbName);

    await Promise.all([firstDb.open(), secondDb.open()]);

    await expect(
      Promise.all([loadOrCreateLocalBook(firstDb), loadOrCreateLocalBook(secondDb)])
    ).resolves.toEqual([
      expect.objectContaining({ id: 'book_local', memo: 'legacy memo' }),
      expect.objectContaining({ id: 'book_local', memo: 'legacy memo' })
    ]);

    firstDb.close();
    secondDb.close();
    await firstDb.delete();
  });

  it('allows legacy auto-import again after the IndexedDB is recreated from scratch', async () => {
    localStorage.setItem('assetTrackerData', JSON.stringify(fixture));

    await loadOrCreateLocalBook(db);
    await db.delete();
    db.close();

    db = new AssetTrackerDb('asset-tracker-db-load-test');
    await db.open();

    const recreatedBook = await loadOrCreateLocalBook(db);

    expect(recreatedBook.memo).toBe('legacy memo');
    expect(await db.transactions.count()).toBe(1);
  });
});
