import type { Book } from '../../shared/types/entities';
import type { OperationLogEntry } from '../db';
import { AssetTrackerDb } from '../db';

function buildPutOperation(book: Book): OperationLogEntry {
  return {
    id: `op_${book.id}_${book.revision}`,
    bookId: book.id,
    entityType: 'book',
    entityId: book.id,
    operationType: 'put',
    payload: JSON.stringify(book),
    deviceId: book.deviceId,
    createdAt: book.updatedAt
  };
}

export class BookRepository {
  constructor(private readonly db: AssetTrackerDb) {}

  getById(id: string): Promise<Book | undefined> {
    return this.db.books.get(id);
  }

  async put(book: Book): Promise<string> {
    await this.db.transaction('rw', this.db.books, this.db.operations, async () => {
      const existing = await this.db.books.get(book.id);

      if (existing && book.revision <= existing.revision) {
        throw new Error('Revision conflict');
      }

      await this.db.books.put(book);
      await this.db.operations.put(buildPutOperation(book));
    });

    return book.id;
  }
}
