import type { OperationLogEntry } from '../db';
import { AssetTrackerDb } from '../db';

export class OperationRepository {
  constructor(private readonly db: AssetTrackerDb) {}

  listByBook(bookId: string): Promise<OperationLogEntry[]> {
    return this.db.operations.where('bookId').equals(bookId).sortBy('createdAt');
  }
}
