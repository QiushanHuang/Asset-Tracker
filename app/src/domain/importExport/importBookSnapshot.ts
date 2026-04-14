import { z } from 'zod';
import type {
  AssetStateAnchor,
  AutomationRule,
  Category,
  Transaction,
  TransactionTemplate
} from '../../shared/types/entities';
import {
  assetStateAnchorSchema,
  automationRuleSchema,
  categorySchema,
  transactionSchema,
  transactionTemplateSchema
} from '../../shared/validation/schemas';
import { AssetTrackerDb } from '../../storage/db';
import { bookSchema } from '../../shared/validation/schemas';
import { bumpMetadata } from '../../shared/utils/entityMetadata';
import { normalizeEffectiveDate } from '../settings/exchangeRateTimeline';

const snapshotSchema = z.object({
  version: z.number().int().positive(),
  exportedAt: z.string(),
  book: z.object({
    name: z.string().min(1),
    baseCurrency: z.enum(['CNY', 'SGD', 'USD', 'MYR']),
    memo: z.string().optional().default('')
  }),
  categories: z.array(categorySchema),
  transactions: z.array(transactionSchema),
  transactionTemplates: z.array(transactionTemplateSchema),
  automationRules: z.array(automationRuleSchema),
  assetStateAnchors: z.array(assetStateAnchorSchema).optional().default([]),
  exchangeRates: z.array(
    z.object({
      currency: z.enum(['CNY', 'SGD', 'USD', 'MYR']),
      rate: z.number().positive(),
      effectiveFrom: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional()
    })
  )
});

export interface ImportBookSnapshotInput {
  bookId: string;
  payload: string;
}

function remapBookId<T extends { bookId: string }>(items: T[], bookId: string): T[] {
  return items.map((item) => ({
    ...item,
    bookId
  }));
}

export async function importBookSnapshot(
  db: AssetTrackerDb,
  input: ImportBookSnapshotInput
): Promise<void> {
  const parsed = snapshotSchema.parse(JSON.parse(input.payload));
  const book = await db.books.get(input.bookId);

  if (!book) {
    throw new Error('Book does not exist');
  }

  const now = new Date().toISOString();
  const importedBook = bookSchema.parse({
    ...book,
    name: parsed.book.name,
    baseCurrency: parsed.book.baseCurrency,
    memo: parsed.book.memo,
    ...bumpMetadata(book, now)
  });
  const categories = remapBookId<Category>(parsed.categories, input.bookId);
  const transactions = remapBookId<Transaction>(parsed.transactions, input.bookId);
  const transactionTemplates = remapBookId<TransactionTemplate>(
    parsed.transactionTemplates,
    input.bookId
  );
  const automationRules = remapBookId<AutomationRule>(parsed.automationRules, input.bookId);
  const assetStateAnchors = remapBookId<AssetStateAnchor>(parsed.assetStateAnchors, input.bookId);
  const exchangeRates = parsed.exchangeRates.map((exchangeRate) => ({
    id: `fx_${input.bookId}_${exchangeRate.currency}_${parsed.book.baseCurrency}_${normalizeEffectiveDate(
      exchangeRate.effectiveFrom ?? parsed.exportedAt
    )}`,
    bookId: input.bookId,
    currency: exchangeRate.currency,
    baseCurrency: parsed.book.baseCurrency,
    rate: exchangeRate.rate,
    effectiveFrom: normalizeEffectiveDate(exchangeRate.effectiveFrom ?? parsed.exportedAt),
    revision: 1,
    deletedAt: null,
    updatedBy: 'local-user',
    deviceId: 'device_local',
    createdAt: now,
    updatedAt: now
  }));

  await db.transaction(
    'rw',
    [
      db.books,
      db.categories,
      db.transactions,
      db.transactionTemplates,
      db.automationRules,
      db.exchangeRates,
      db.assetStateAnchors,
      db.operations
    ],
    async () => {
      await db.books.put(importedBook);
      await db.categories.where('bookId').equals(input.bookId).delete();
      await db.transactions.where('bookId').equals(input.bookId).delete();
      await db.transactionTemplates.where('bookId').equals(input.bookId).delete();
      await db.automationRules.where('bookId').equals(input.bookId).delete();
      await db.exchangeRates.where('bookId').equals(input.bookId).delete();
      await db.assetStateAnchors.where('bookId').equals(input.bookId).delete();
      await db.operations.where('bookId').equals(input.bookId).delete();
      await db.categories.bulkPut(categories);
      await db.transactions.bulkPut(transactions);
      await db.transactionTemplates.bulkPut(transactionTemplates);
      await db.automationRules.bulkPut(automationRules);
      await db.exchangeRates.bulkPut(exchangeRates);
      await db.assetStateAnchors.bulkPut(assetStateAnchors);
    }
  );
}
