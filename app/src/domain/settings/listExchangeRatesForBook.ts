import { AssetTrackerDb } from '../../storage/db';
import { ExchangeRateRepository } from '../../storage/repositories/exchangeRateRepository';
import { listEffectiveExchangeRates } from './exchangeRateTimeline';

export async function listExchangeRatesForBook(
  db: AssetTrackerDb,
  bookId: string,
  asOf?: string
) {
  const book = await db.books.get(bookId);

  if (!book) {
    throw new Error('Book does not exist');
  }

  const repository = new ExchangeRateRepository(db);

  return listEffectiveExchangeRates(await repository.listByBook(bookId), book.baseCurrency, asOf);
}
