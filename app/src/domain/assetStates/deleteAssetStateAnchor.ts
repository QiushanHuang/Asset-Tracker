import { markDeleted } from '../../shared/utils/entityMetadata';
import { AssetTrackerDb } from '../../storage/db';
import { AssetStateAnchorRepository } from '../../storage/repositories/assetStateAnchorRepository';

export interface DeleteAssetStateAnchorInput {
  bookId: string;
  anchorId: string;
}

export async function deleteAssetStateAnchor(
  db: AssetTrackerDb,
  input: DeleteAssetStateAnchorInput
): Promise<void> {
  const repository = new AssetStateAnchorRepository(db);
  const anchor = await repository.get(input.anchorId);

  if (!anchor || anchor.deletedAt !== null || anchor.bookId !== input.bookId) {
    throw new Error('Asset state does not exist');
  }

  await repository.put({
    ...anchor,
    ...markDeleted(anchor)
  });
}
