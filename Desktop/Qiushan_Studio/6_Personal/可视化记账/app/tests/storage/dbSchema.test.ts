import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { AssetTrackerDb } from '../../src/storage/db';

describe('AssetTrackerDb', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-test');
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('creates stores for books, categories, transactions, and operations', () => {
    expect(db.tables.map((table) => table.name)).toEqual([
      'books',
      'categories',
      'transactions',
      'operations'
    ]);
  });
});
