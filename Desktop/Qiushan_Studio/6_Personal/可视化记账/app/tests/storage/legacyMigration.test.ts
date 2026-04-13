import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import fixture from '../fixtures/legacy/assetTrackerData.sample.json';
import { AssetTrackerDb } from '../../src/storage/db';
import { deterministicId } from '../../src/storage/migrations/legacyDeterministicId';
import { buildCategoryPath } from '../../src/storage/migrations/legacyCategoryPath';
import { buildLegacyMigrationManifest } from '../../src/storage/migrations/legacyMigrationManifest';
import { migrateLegacyAssetTracker } from '../../src/storage/migrations/migrateLegacyAssetTracker';

describe('buildLegacyMigrationManifest', () => {
  it('resolves duplicate category names by full path', () => {
    const manifest = buildLegacyMigrationManifest(fixture as never);
    const bankPath = buildCategoryPath(null, '银行卡');
    const chinaPath = buildCategoryPath(bankPath, '中国');
    const singaporePath = buildCategoryPath(bankPath, '新加坡');
    const alipayPath = buildCategoryPath(null, '支付宝');
    const chinaIcbcPath = buildCategoryPath(
      chinaPath,
      'ICBC'
    );
    const singaporeIcbcPath = buildCategoryPath(
      singaporePath,
      'ICBC'
    );
    const walletPath = buildCategoryPath(alipayPath, '钱包');

    expect(manifest.categoryPathToId[chinaIcbcPath]).not.toBe(
      manifest.categoryPathToId[singaporeIcbcPath]
    );
    expect(manifest.categoryPathToId[walletPath]).toBeDefined();
  });

  it('creates opening adjustments from legacy balances', () => {
    const manifest = buildLegacyMigrationManifest(fixture as never);

    expect(manifest.openingAdjustments.length).toBeGreaterThan(0);
    expect(manifest.report.totalCategories).toBeGreaterThan(0);
    expect(manifest.report.totalTransactions).toBeGreaterThan(0);
  });

  it('generates distinct deterministic ids for escaped path segments', () => {
    const leftPath = buildCategoryPath(null, 'A/B__C');
    const rightPath = buildCategoryPath(null, 'A__B/C');

    expect(deterministicId('cat', leftPath)).not.toBe(deterministicId('cat', rightPath));
  });

  it('does not collide with literal escape-like path names', () => {
    const encodedSlashPath = buildCategoryPath(null, 'A/B');
    const literalEscapeLikePath = buildCategoryPath(null, 'A_252FB');

    expect(deterministicId('cat', encodedSlashPath)).not.toBe(
      deterministicId('cat', literalEscapeLikePath)
    );
  });
});

describe('migrateLegacyAssetTracker', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-legacy-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('returns the dry-run manifest while recording the legacy backup', async () => {
    const manifest = await migrateLegacyAssetTracker(db, fixture as unknown);

    expect(manifest.report.totalCategories).toBeGreaterThan(0);
    expect((await db.operations.toArray())[0]?.id).toBe('op_legacy_backup_1');
  });

  it('preserves unmapped legacy fields in the raw backup payload', async () => {
    await migrateLegacyAssetTracker(db, {
      ...fixture,
      legacyOnlyField: {
        keep: true
      }
    } as unknown);

    expect((await db.operations.toArray())[0]?.payload).toContain('legacyOnlyField');
  });

  it('rejects empty manifests before persisting backup operations', async () => {
    await expect(
      migrateLegacyAssetTracker(db, {
        categories: {},
        transactions: []
      } as unknown)
    ).rejects.toThrow('Migration manifest is empty');

    expect(await db.operations.toArray()).toEqual([]);
  });
});
