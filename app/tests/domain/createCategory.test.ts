import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { listCategoryTree } from '../../src/domain/categories/listCategoryTree';
import { AssetTrackerDb } from '../../src/storage/db';

describe('createCategory', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-create-category');
    await db.delete();
    await db.open();
  });

  it('creates a root category and returns it in the tree query', async () => {
    const book = await loadOrCreateLocalBook(db);

    await createCategory(db, {
      bookId: book.id,
      name: '支付宝',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    const tree = await listCategoryTree(db, book.id);

    expect(tree).toEqual([
      expect.objectContaining({
        name: '支付宝',
        depth: 0,
        aggregateAmount: 0
      })
    ]);
  });
});
