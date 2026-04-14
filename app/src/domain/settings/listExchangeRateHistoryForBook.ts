import { AssetTrackerDb } from '../../storage/db';
import { ExchangeRateRepository } from '../../storage/repositories/exchangeRateRepository';
import { listExchangeRateHistory } from './exchangeRateTimeline';

export async function listExchangeRateHistoryForBook(db: AssetTrackerDb, bookId: string) {
  const book = await db.books.get(bookId);

  if (!book) {
    throw new Error('Book does not exist');
  }

  return listExchangeRateHistory(
    await new ExchangeRateRepository(db).listByBook(bookId),
    book.baseCurrency
  );
}
