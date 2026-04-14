import type { Book } from '../../shared/types/entities';
import { AssetTrackerDb } from '../../storage/db';
import { BookRepository } from '../../storage/repositories/bookRepository';
import { maybeImportLegacyBrowserState } from './maybeImportLegacyBrowserState';
import { repairPersistedLocalBookData } from './repairPersistedLocalBookData';

export async function loadOrCreateLocalBook(db: AssetTrackerDb): Promise<Book> {
  const repository = new BookRepository(db);
  const existing = await repository.getById('book_local');
  let localBook = existing;

  if (!localBook) {
    const now = new Date().toISOString();
    const book: Book = {
      id: 'book_local',
      name: 'Local Book',
      type: 'private',
      baseCurrency: 'CNY',
      memo: '',
      revision: 1,
      deletedAt: null,
      updatedBy: 'local-user',
      deviceId: 'device_local',
      createdAt: now,
      updatedAt: now
    };

    try {
      await repository.put(book);
      localBook = book;
    } catch (error) {
      if (error instanceof Error && error.message === 'Revision conflict') {
        localBook = await repository.getById('book_local');
      } else {
        throw error;
      }
    }
  }

  if (!localBook) {
    throw new Error('Book does not exist');
  }

  await maybeImportLegacyBrowserState(db, localBook);
  const latest = await repository.getById(localBook.id);

  if (!latest) {
    throw new Error('Book does not exist');
  }

  return repairPersistedLocalBookData(db, latest);
}
