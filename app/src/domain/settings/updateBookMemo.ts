import type { Book } from '../../shared/types/entities';
import { bookSchema } from '../../shared/validation/schemas';
import { bumpMetadata } from '../../shared/utils/entityMetadata';
import { AssetTrackerDb } from '../../storage/db';
import { BookRepository } from '../../storage/repositories/bookRepository';

export interface UpdateBookMemoInput {
  bookId: string;
  memo: string;
}

export async function updateBookMemo(
  db: AssetTrackerDb,
  input: UpdateBookMemoInput
): Promise<Book> {
  const repository = new BookRepository(db);
  const book = await db.books.get(input.bookId);

  if (!book || book.deletedAt !== null) {
    throw new Error('Book does not exist');
  }

  const now = new Date().toISOString();
  const updated = bookSchema.parse({
    ...book,
    memo: input.memo.trim(),
    ...bumpMetadata(book, now)
  });

  await repository.put(updated);

  return updated;
}
