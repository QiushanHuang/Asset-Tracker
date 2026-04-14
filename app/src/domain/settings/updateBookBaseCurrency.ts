import type { Book, CurrencyCode } from '../../shared/types/entities';
import { bookSchema } from '../../shared/validation/schemas';
import { bumpMetadata, markDeleted } from '../../shared/utils/entityMetadata';
import { AssetTrackerDb } from '../../storage/db';
import { BookRepository } from '../../storage/repositories/bookRepository';
import { ExchangeRateRepository } from '../../storage/repositories/exchangeRateRepository';

export interface UpdateBookBaseCurrencyInput {
  bookId: string;
  baseCurrency: CurrencyCode;
}

export async function updateBookBaseCurrency(
  db: AssetTrackerDb,
  input: UpdateBookBaseCurrencyInput
): Promise<Book> {
  const repository = new BookRepository(db);
  const exchangeRateRepository = new ExchangeRateRepository(db);
  const [book, exchangeRates] = await Promise.all([
    db.books.get(input.bookId),
    exchangeRateRepository.listByBook(input.bookId)
  ]);

  if (!book || book.deletedAt !== null) {
    throw new Error('Book does not exist');
  }

  if (book.baseCurrency === input.baseCurrency) {
    return book;
  }

  const now = new Date().toISOString();

  const updated = bookSchema.parse({
    ...book,
    baseCurrency: input.baseCurrency,
    memo: typeof book.memo === 'string' ? book.memo : '',
    ...bumpMetadata(book, now)
  });
  const retiredRates = exchangeRates
    .filter((exchangeRate) => exchangeRate.deletedAt === null)
    .map((exchangeRate) => ({
      ...exchangeRate,
      ...markDeleted(exchangeRate, now)
    }));

  await repository.put(updated);

  if (retiredRates.length > 0) {
    await exchangeRateRepository.putMany(retiredRates);
  }

  return updated;
}
