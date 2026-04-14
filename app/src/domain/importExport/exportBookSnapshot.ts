import { AssetTrackerDb } from '../../storage/db';
import { AssetStateAnchorRepository } from '../../storage/repositories/assetStateAnchorRepository';
import { AutomationRuleRepository } from '../../storage/repositories/automationRuleRepository';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';
import { ExchangeRateRepository } from '../../storage/repositories/exchangeRateRepository';
import { TransactionRepository } from '../../storage/repositories/transactionRepository';
import { TransactionTemplateRepository } from '../../storage/repositories/transactionTemplateRepository';
import { listExchangeRateHistory } from '../settings/exchangeRateTimeline';

export async function exportBookSnapshot(db: AssetTrackerDb, bookId: string): Promise<string> {
  const book = await db.books.get(bookId);

  if (!book) {
    throw new Error('Book does not exist');
  }

  const [categories, transactions, transactionTemplates, automationRules, exchangeRates, assetStateAnchors] =
    await Promise.all([
      new CategoryRepository(db).listByBook(bookId),
      new TransactionRepository(db).listByBook(bookId),
      new TransactionTemplateRepository(db).listByBook(bookId),
      new AutomationRuleRepository(db).listByBook(bookId),
      new ExchangeRateRepository(db).listByBook(bookId),
      new AssetStateAnchorRepository(db).listByBook(bookId)
    ]);

  return JSON.stringify(
    {
      version: 3,
      exportedAt: new Date().toISOString(),
      book: {
        name: book.name,
        baseCurrency: book.baseCurrency,
        memo: typeof book.memo === 'string' ? book.memo : ''
      },
      categories: categories.filter((item) => item.deletedAt === null),
      transactions: transactions.filter((item) => item.deletedAt === null),
      transactionTemplates: transactionTemplates.filter((item) => item.deletedAt === null),
      automationRules: automationRules.filter((item) => item.deletedAt === null),
      assetStateAnchors: assetStateAnchors.filter((item) => item.deletedAt === null),
      exchangeRates: listExchangeRateHistory(exchangeRates, book.baseCurrency)
        .map((exchangeRate) => ({
          currency: exchangeRate.currency,
          rate: exchangeRate.rate,
          effectiveFrom: exchangeRate.effectiveFrom
        }))
    },
    null,
    2
  );
}
