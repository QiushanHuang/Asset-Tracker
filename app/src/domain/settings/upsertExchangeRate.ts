import type { CurrencyCode, ExchangeRate } from '../../shared/types/entities';
import { exchangeRateSchema } from '../../shared/validation/schemas';
import { bumpMetadata, createMetadata } from '../../shared/utils/entityMetadata';
import { AssetTrackerDb } from '../../storage/db';
import { ExchangeRateRepository } from '../../storage/repositories/exchangeRateRepository';
import { normalizeEffectiveDate } from './exchangeRateTimeline';

export interface UpsertExchangeRateInput {
  bookId: string;
  currency: CurrencyCode;
  baseCurrency: CurrencyCode;
  rate: number;
  effectiveFrom?: string;
}

export async function upsertExchangeRate(
  db: AssetTrackerDb,
  input: UpsertExchangeRateInput
): Promise<ExchangeRate> {
  const repository = new ExchangeRateRepository(db);
  const effectiveFrom = normalizeEffectiveDate(input.effectiveFrom ?? new Date().toISOString());
  const existing = (await repository.listByBook(input.bookId)).find(
    (exchangeRate) =>
      exchangeRate.currency === input.currency &&
      exchangeRate.baseCurrency === input.baseCurrency &&
      exchangeRate.effectiveFrom === effectiveFrom
  );
  const now = new Date().toISOString();

  if (existing) {
    const updated = exchangeRateSchema.parse({
      ...existing,
      baseCurrency: input.baseCurrency,
      rate: input.rate,
      effectiveFrom,
      ...bumpMetadata(existing, now),
      deletedAt: null
    });

    await repository.put(updated);
    return updated;
  }

  const exchangeRate = exchangeRateSchema.parse({
    id: `fx_${input.bookId}_${input.currency}_${input.baseCurrency}_${effectiveFrom}`,
    bookId: input.bookId,
    currency: input.currency,
    baseCurrency: input.baseCurrency,
    rate: input.rate,
    effectiveFrom,
    ...createMetadata(now)
  });

  await repository.put(exchangeRate);

  return exchangeRate;
}
