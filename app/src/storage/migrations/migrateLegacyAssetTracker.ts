import { AssetTrackerDb } from '../db';
import { buildLegacyMigrationManifest } from './legacyMigrationManifest';
import { buildLegacyRawBackup } from './legacySnapshot';
import {
  parseLegacyAssetTrackerData,
  type LegacyMigrationManifest
} from './types';

export async function migrateLegacyAssetTracker(
  db: AssetTrackerDb,
  input: unknown
): Promise<LegacyMigrationManifest> {
  const parsed = parseLegacyAssetTrackerData(input);
  const backup = buildLegacyRawBackup(input);
  const manifest = buildLegacyMigrationManifest(parsed);

  if (manifest.report.totalCategories === 0) {
    throw new Error('Migration manifest is empty');
  }

  const createdAt = parsed.exportTime ?? '1970-01-01T00:00:00.000Z';

  await db.transaction('rw', db.operations, async () => {
    await db.operations.put({
      id: 'op_legacy_backup_1',
      bookId: 'book_local',
      entityType: 'book',
      entityId: 'book_local',
      operationType: 'put',
      payload: backup,
      deviceId: 'device_local',
      createdAt
    });
  });

  return manifest;
}
