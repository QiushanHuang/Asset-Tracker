import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fixture from './fixtures/legacy/assetTrackerData.sample.json';
import { loadOrCreateLocalBook } from '../src/domain/bootstrap/loadOrCreateLocalBook';
import { AssetTrackerDb } from '../src/storage/db';
import { buildLegacyMigrationManifest } from '../src/storage/migrations/legacyMigrationManifest';

describe('checkpoint 1 acceptance', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-acceptance');
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('produces a stable manifest and can still create the local book', async () => {
    const manifestA = buildLegacyMigrationManifest(fixture as never);
    const manifestB = buildLegacyMigrationManifest(fixture as never);

    expect(manifestA).toEqual(manifestB);

    const book = await loadOrCreateLocalBook(db);

    expect(book.id).toBe('book_local');
    expect(manifestA.report.totalCategories).toBeGreaterThan(0);
  });
});
