import type { AssetStateAnchor } from '../../shared/types/entities';
import type { OperationLogEntry } from '../db';
import { AssetTrackerDb } from '../db';

function buildPutOperation(anchor: AssetStateAnchor): OperationLogEntry {
  return {
    id: `op_${anchor.id}_${anchor.revision}`,
    bookId: anchor.bookId,
    entityType: 'assetStateAnchor',
    entityId: anchor.id,
    operationType: 'put',
    payload: JSON.stringify(anchor),
    deviceId: anchor.deviceId,
    createdAt: anchor.updatedAt
  };
}

export class AssetStateAnchorRepository {
  constructor(private readonly db: AssetTrackerDb) {}

  listByBook(bookId: string): Promise<AssetStateAnchor[]> {
    return this.db.assetStateAnchors.where('bookId').equals(bookId).sortBy('anchoredAt');
  }

  listByCategory(categoryId: string): Promise<AssetStateAnchor[]> {
    return this.db.assetStateAnchors.where('categoryId').equals(categoryId).sortBy('anchoredAt');
  }

  get(anchorId: string): Promise<AssetStateAnchor | undefined> {
    return this.db.assetStateAnchors.get(anchorId);
  }

  async put(anchor: AssetStateAnchor): Promise<void> {
    await this.putMany([anchor]);
  }

  async putMany(anchors: AssetStateAnchor[]): Promise<void> {
    await this.db.transaction('rw', this.db.assetStateAnchors, this.db.operations, async () => {
      for (const anchor of anchors) {
        const existing = await this.db.assetStateAnchors.get(anchor.id);

        if (existing && anchor.revision <= existing.revision) {
          throw new Error('Revision conflict');
        }
      }

      await this.db.assetStateAnchors.bulkPut(anchors);
      await this.db.operations.bulkPut(anchors.map((anchor) => buildPutOperation(anchor)));
    });
  }
}
