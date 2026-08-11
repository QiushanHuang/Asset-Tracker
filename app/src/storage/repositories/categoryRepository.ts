import type { Category } from '../../shared/types/entities';
import type { OperationLogEntry } from '../db';
import { AssetTrackerDb } from '../db';

function buildPutOperation(category: Category): OperationLogEntry {
  return {
    id: `op_${category.id}_${category.revision}`,
    bookId: category.bookId,
    entityType: 'category',
    entityId: category.id,
    operationType: 'put',
    payload: JSON.stringify(category),
    deviceId: category.deviceId,
    createdAt: category.updatedAt
  };
}

export class CategoryRepository {
  constructor(private readonly db: AssetTrackerDb) {}

  listByBook(bookId: string): Promise<Category[]> {
    return this.db.categories.where('bookId').equals(bookId).sortBy('sortOrder');
  }

  get(categoryId: string): Promise<Category | undefined> {
    return this.db.categories.get(categoryId);
  }

  async put(category: Category): Promise<void> {
    await this.putMany([category]);
  }

  async putMany(categories: Category[]): Promise<void> {
    await this.db.transaction('rw', this.db.categories, this.db.operations, async () => {
      for (const category of categories) {
        const existing = await this.db.categories.get(category.id);

        if (existing && category.revision <= existing.revision) {
          throw new Error('Revision conflict');
        }
      }

      await this.db.categories.bulkPut(categories);
      await this.db.operations.bulkPut(categories.map((category) => buildPutOperation(category)));
    });
  }
}
