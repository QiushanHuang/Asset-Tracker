import type { CurrencyCode, ExchangeRate } from '../../shared/types/entities';

const FUTURE_SENTINEL_DATE = '9999-12-31';

export function normalizeEffectiveDate(value: string): string {
  return /^\d{4}-\d{2}-\d{2}$/.test(value) ? value : value.slice(0, 10);
}

function compareHistory(left: ExchangeRate, right: ExchangeRate): number {
  return (
    left.currency.localeCompare(right.currency) ||
    right.effectiveFrom.localeCompare(left.effectiveFrom) ||
    right.updatedAt.localeCompare(left.updatedAt)
  );
}

export function listExchangeRateHistory(
  exchangeRates: ExchangeRate[],
  baseCurrency: CurrencyCode
): ExchangeRate[] {
  return exchangeRates
    .filter((exchangeRate) => exchangeRate.deletedAt === null && exchangeRate.baseCurrency === baseCurrency)
    .sort(compareHistory);
}

export function listEffectiveExchangeRates(
  exchangeRates: ExchangeRate[],
  baseCurrency: CurrencyCode,
  asOf?: string
): ExchangeRate[] {
  const targetDate = asOf ? normalizeEffectiveDate(asOf) : FUTURE_SENTINEL_DATE;
  const latestByCurrency = new Map<CurrencyCode, ExchangeRate>();

  listExchangeRateHistory(exchangeRates, baseCurrency).forEach((exchangeRate) => {
    if (exchangeRate.effectiveFrom > targetDate || latestByCurrency.has(exchangeRate.currency)) {
      return;
    }

    latestByCurrency.set(exchangeRate.currency, exchangeRate);
  });

  return [...latestByCurrency.values()].sort((left, right) => left.currency.localeCompare(right.currency));
}

export function resolveExchangeRateAt(
  exchangeRates: ExchangeRate[],
  baseCurrency: CurrencyCode,
  currency: CurrencyCode,
  asOf: string
): ExchangeRate | null {
  if (currency === baseCurrency) {
    return null;
  }

  const targetDate = normalizeEffectiveDate(asOf);

  return (
    listExchangeRateHistory(exchangeRates, baseCurrency).find(
      (exchangeRate) =>
        exchangeRate.currency === currency && exchangeRate.effectiveFrom <= targetDate
    ) ?? null
  );
}
