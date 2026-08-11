import { listAssetStateAnchorsForBook } from '../assetStates/listAssetStateAnchorsForBook';
import {
  buildCategoryTreeSnapshot,
  listLeafCategoryBalancesAt,
  loadBalanceContext,
  summarizeBookBalancesAt,
  type BalanceContext,
  type LeafCategoryBalance
} from '../balances/balanceEngine';
import type { CurrencyCode } from '../../shared/types/entities';
import { listAutomationOccurrences } from '../automation/schedule';
import { AssetTrackerDb } from '../../storage/db';
import { AutomationRuleRepository } from '../../storage/repositories/automationRuleRepository';
import { resolveExchangeRateAt } from '../settings/exchangeRateTimeline';

export interface AnalyticsSnapshotInput {
  bookId: string;
  asOf: string;
  compareAt: string;
  trendDays: number;
  metric: 'net' | 'asset' | 'debt';
  focusCategoryId?: string;
  forecastDays?: number;
}

export interface AnalyticsTrendPoint {
  label: string;
  asOf: string;
  value: number;
}

export interface AnalyticsCurrencyComparisonItem {
  currency: string;
  currentNetAmount: number;
  compareNetAmount: number;
  currentConvertedNetAmount: number | null;
  compareConvertedNetAmount: number | null;
}

export interface AnalyticsCategoryCompositionItem {
  categoryId: string;
  name: string;
  currency: string;
  kind: 'asset' | 'debt';
  amount: number;
}

export interface AnalyticsForecastPoint {
  label: string;
  asOf: string;
  value: number;
}

export interface AnalyticsCashflowProjectionItem {
  label: string;
  amount: number;
  frequency: string;
}

export interface AnalyticsRadarMetric {
  label: string;
  value: number;
}

export interface AnalyticsSnapshot {
  asOf: string;
  compareAt: string;
  metric: 'net' | 'asset' | 'debt';
  currentSummary: ReturnType<typeof summarizeBookBalancesAt>;
  compareSummary: ReturnType<typeof summarizeBookBalancesAt>;
  trend: AnalyticsTrendPoint[];
  forecast: AnalyticsForecastPoint[];
  categoryComposition: AnalyticsCategoryCompositionItem[];
  currencyComparison: AnalyticsCurrencyComparisonItem[];
  anchorTimeline: Awaited<ReturnType<typeof listAssetStateAnchorsForBook>>;
  categoryTree: ReturnType<typeof buildCategoryTreeSnapshot>;
  cashflowProjection: AnalyticsCashflowProjectionItem[];
  radarMetrics: AnalyticsRadarMetric[];
}

function addDays(isoString: string, days: number): string {
  const date = new Date(isoString);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function addDaysToDate(date: string, days: number): string {
  return addDays(`${date}T00:00:00.000Z`, days).slice(0, 10);
}

function formatTrendLabel(isoString: string): string {
  const date = new Date(isoString);
  const month = String(date.getUTCMonth() + 1).padStart(2, '0');
  const day = String(date.getUTCDate()).padStart(2, '0');

  return `${month}-${day}`;
}

function summarizeLeafBalances(
  context: BalanceContext,
  balances: LeafCategoryBalance[],
  asOf: string
): ReturnType<typeof summarizeBookBalancesAt> {
  const rawBreakdown = new Map<CurrencyCode, { assetAmount: number; debtAmount: number }>();

  for (const balance of balances) {
    if (balance.amount === 0) {
      continue;
    }

    const totals = rawBreakdown.get(balance.currency) ?? { assetAmount: 0, debtAmount: 0 };

    if (balance.kind === 'debt') {
      if (balance.amount < 0) {
        totals.debtAmount += Math.abs(balance.amount);
      } else {
        totals.assetAmount += balance.amount;
      }
    } else {
      totals.assetAmount += balance.amount;
    }

    rawBreakdown.set(balance.currency, totals);
  }

  let assetAmount = 0;
  let debtAmount = 0;
  const unresolvedCurrencies: string[] = [];
  const currencyBreakdown: Array<{
    currency: CurrencyCode;
    assetAmount: number;
    debtAmount: number;
    netAmount: number;
    convertedNetAmount: number | null;
  }> = [];

  rawBreakdown.forEach((totals, currency) => {
    const netAmount = totals.assetAmount - totals.debtAmount;
    const rate =
      currency === context.book.baseCurrency
        ? 1
        : resolveExchangeRateAt(context.exchangeRates, context.book.baseCurrency, currency, asOf)?.rate;
    const convertedNetAmount = rate ? Math.round(netAmount * rate) : null;

    if (rate) {
      assetAmount += Math.round(totals.assetAmount * rate);
      debtAmount += Math.round(totals.debtAmount * rate);
    } else {
      unresolvedCurrencies.push(currency);
    }

    currencyBreakdown.push({
      currency,
      assetAmount: totals.assetAmount,
      debtAmount: totals.debtAmount,
      netAmount,
      convertedNetAmount
    });
  });

  return {
    netAmount: assetAmount - debtAmount,
    assetAmount,
    debtAmount,
    transactionCount: context.transactions.length,
    unresolvedCurrencies: unresolvedCurrencies.sort(),
    currencyBreakdown: currencyBreakdown.sort((left, right) => left.currency.localeCompare(right.currency))
  };
}

function metricValue(
  summary: ReturnType<typeof summarizeBookBalancesAt>,
  metric: 'net' | 'asset' | 'debt'
): number {
  if (metric === 'asset') {
    return summary.assetAmount;
  }

  if (metric === 'debt') {
    return summary.debtAmount;
  }

  return summary.netAmount;
}

export async function calculateAnalyticsSnapshot(
  db: AssetTrackerDb,
  input: AnalyticsSnapshotInput
): Promise<AnalyticsSnapshot> {
  const context = await loadBalanceContext(db, input.bookId);
  const [anchorTimeline, rawRules] = await Promise.all([
    listAssetStateAnchorsForBook(db, input.bookId),
    new AutomationRuleRepository(db).listByBook(input.bookId)
  ]);
  const currentSummary = summarizeBookBalancesAt(context, input.asOf);
  const compareSummary = summarizeBookBalancesAt(context, input.compareAt);
  const categoryComposition = listLeafCategoryBalancesAt(context, input.asOf)
    .filter((item) => (input.focusCategoryId ? item.categoryId === input.focusCategoryId : item.amount !== 0))
    .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount));
  const currentBreakdownByCurrency = new Map(
    currentSummary.currencyBreakdown.map((item) => [item.currency, item])
  );
  const compareBreakdownByCurrency = new Map(
    compareSummary.currencyBreakdown.map((item) => [item.currency, item])
  );
  const currencies = [
    ...new Set([...currentBreakdownByCurrency.keys(), ...compareBreakdownByCurrency.keys()])
  ].sort() as CurrencyCode[];
  const categoryTree = buildCategoryTreeSnapshot(context, input.asOf);
  const trend = Array.from({ length: Math.max(1, input.trendDays) }, (_, index) => {
    const pointAsOf = addDays(input.asOf, index - (Math.max(1, input.trendDays) - 1));
    const pointSummary = summarizeBookBalancesAt(context, pointAsOf);
    const pointLeafBalances = input.focusCategoryId
      ? listLeafCategoryBalancesAt(context, pointAsOf)
      : [];
    const pointValue = input.focusCategoryId
      ? (pointLeafBalances.find((item) => item.categoryId === input.focusCategoryId)?.amount ?? 0)
      : metricValue(pointSummary, input.metric);

    return {
      label: formatTrendLabel(pointAsOf),
      asOf: pointAsOf,
      value: pointValue
    };
  });

  const forecastDays = Math.max(7, input.forecastDays ?? 30);
  const forecastStartDate = input.asOf.slice(0, 10);
  const forecastEndDate = addDaysToDate(forecastStartDate, forecastDays);
  const activeRules = rawRules.filter((rule) => rule.deletedAt === null && rule.isActive);
  const forecastBalanceMap = new Map(
    listLeafCategoryBalancesAt(context, input.asOf).map((item) => [item.categoryId, { ...item }])
  );
  const cashflowByDate = new Map<string, Array<{ categoryId: string; amount: number }>>();
  const cashflowByLabel = new Map<string, { amount: number; frequency: string }>();

  activeRules.forEach((rule) => {
    listAutomationOccurrences(rule, forecastEndDate, forecastStartDate)
      .filter((occurrence) => occurrence.occurredAt > input.asOf)
      .forEach((occurrence) => {
        const items = cashflowByDate.get(occurrence.date) ?? [];
        items.push({
          categoryId: rule.categoryId,
          amount: rule.amount
        });
        cashflowByDate.set(occurrence.date, items);
      });

    const projection = cashflowByLabel.get(rule.purpose) ?? {
      amount: 0,
      frequency: rule.frequency
    };
    projection.amount += rule.amount;
    cashflowByLabel.set(rule.purpose, projection);
  });

  const forecast: AnalyticsForecastPoint[] = [
    {
      label: formatTrendLabel(input.asOf),
      asOf: input.asOf,
      value: metricValue(currentSummary, input.metric)
    }
  ];

  Array.from({ length: forecastDays }, (_, index) => addDaysToDate(forecastStartDate, index + 1)).forEach(
    (date) => {
      (cashflowByDate.get(date) ?? []).forEach((delta) => {
        const existing = forecastBalanceMap.get(delta.categoryId);

        if (!existing) {
          return;
        }

        forecastBalanceMap.set(delta.categoryId, {
          ...existing,
          amount: existing.amount + delta.amount
        });
      });

      const projectedSummary = summarizeLeafBalances(
        context,
        [...forecastBalanceMap.values()],
        `${date}T00:00:00.000Z`
      );
      forecast.push({
        label: formatTrendLabel(`${date}T00:00:00.000Z`),
        asOf: `${date}T00:00:00.000Z`,
        value: metricValue(projectedSummary, input.metric)
      });
    }
  );

  const leafCount = listLeafCategoryBalancesAt(context, input.asOf).length || 1;
  const radarMetrics: AnalyticsRadarMetric[] = [
    {
      label: '资产强度',
      value:
        currentSummary.assetAmount <= 0
          ? 0
          : Math.min(100, Math.round((currentSummary.assetAmount / Math.max(currentSummary.assetAmount, currentSummary.debtAmount || 1)) * 100))
    },
    {
      label: '负债压力',
      value:
        currentSummary.debtAmount <= 0
          ? 0
          : Math.min(100, Math.round((currentSummary.debtAmount / Math.max(currentSummary.assetAmount, currentSummary.debtAmount)) * 100))
    },
    {
      label: '币种覆盖',
      value: Math.min(100, Math.round((currencies.length / 4) * 100))
    },
    {
      label: '盘点覆盖',
      value: Math.min(100, Math.round((anchorTimeline.length / leafCount) * 100))
    },
    {
      label: '自动化密度',
      value: Math.min(100, activeRules.length * 18)
    }
  ];

  return {
    asOf: input.asOf,
    compareAt: input.compareAt,
    metric: input.metric,
    currentSummary,
    compareSummary,
    trend,
    forecast,
    categoryComposition,
    currencyComparison: currencies.map((currency) => {
      const currentItem = currentBreakdownByCurrency.get(currency);
      const compareItem = compareBreakdownByCurrency.get(currency);
      const currentRate =
        currency === context.book.baseCurrency
          ? 1
          : resolveExchangeRateAt(context.exchangeRates, context.book.baseCurrency, currency, input.asOf)?.rate;
      const compareRate =
        currency === context.book.baseCurrency
          ? 1
          : resolveExchangeRateAt(context.exchangeRates, context.book.baseCurrency, currency, input.compareAt)?.rate;

      return {
        currency,
        currentNetAmount: currentItem?.netAmount ?? 0,
        compareNetAmount: compareItem?.netAmount ?? 0,
        currentConvertedNetAmount:
          currentItem?.convertedNetAmount ?? (currentRate ? 0 : null),
        compareConvertedNetAmount:
          compareItem?.convertedNetAmount ?? (compareRate ? 0 : null)
      };
    }),
    anchorTimeline,
    categoryTree,
    cashflowProjection: [...cashflowByLabel.entries()]
      .map(([label, item]) => ({
        label,
        amount: item.amount,
        frequency: item.frequency
      }))
      .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))
      .slice(0, 8),
    radarMetrics
  };
}
