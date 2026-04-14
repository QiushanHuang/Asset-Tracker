import 'fake-indexeddb/auto';
import Dexie from 'dexie';
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

  it('creates stores for books, categories, transactions, templates, automation rules, exchange rates, asset states, and operations', () => {
    expect(db.tables.map((table) => table.name)).toEqual([
      'books',
      'categories',
      'transactions',
      'transactionTemplates',
      'automationRules',
      'exchangeRates',
      'assetStateAnchors',
      'operations'
    ]);
  });

  it('upgrades a version-1 database to the latest schema', async () => {
    const name = `asset-tracker-db-upgrade-${crypto.randomUUID()}`;
    const legacyDb = new Dexie(name);

    legacyDb.version(1).stores({
      books: '&id, updatedAt, deletedAt',
      categories: '&id, bookId, parentId, sortOrder, updatedAt, deletedAt',
      transactions: '&id, bookId, categoryId, occurredAt, updatedAt, deletedAt',
      operations: '&id, bookId, entityType, entityId, createdAt'
    });

    await legacyDb.open();
    await legacyDb.close();

    const upgraded = new AssetTrackerDb(name);

    await expect(upgraded.open()).resolves.toBe(upgraded);
    expect(upgraded.tables.map((table) => table.name)).toEqual([
      'books',
      'categories',
      'transactions',
      'transactionTemplates',
      'automationRules',
      'exchangeRates',
      'assetStateAnchors',
      'operations'
    ]);

    await upgraded.delete();
    upgraded.close();
  });
});
