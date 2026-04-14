import { listLeafCategoryBalancesAt, loadBalanceContext, summarizeBookBalancesAt } from '../balances/balanceEngine';
import { AssetTrackerDb } from '../../storage/db';
import { listTransactionsForBook, type TransactionListItem } from '../transactions/listTransactionsForBook';

export type DashboardTrendPeriod = 'week' | 'month' | 'year';

export interface DashboardTrendPoint {
  label: string;
  asOf: string;
  value: number;
}

export interface DashboardSnapshot {
  asOf: string;
  currentSummary: ReturnType<typeof summarizeBookBalancesAt>;
  previousWeekSummary: ReturnType<typeof summarizeBookBalancesAt>;
  previousMonthSummary: ReturnType<typeof summarizeBookBalancesAt>;
  selectedPeriod: DashboardTrendPeriod;
  selectedPeriodLabel: string;
  selectedPeriodDelta: number;
  trend: DashboardTrendPoint[];
  topAssets: ReturnType<typeof listLeafCategoryBalancesAt>;
  topDebts: ReturnType<typeof listLeafCategoryBalancesAt>;
  recentTransactions: TransactionListItem[];
  memo: string;
}

function addDays(isoString: string, days: number): string {
  const date = new Date(isoString);
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString();
}

function formatTrendLabel(isoString: string): string {
  const date = new Date(isoString);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}-${String(date.getUTCDate()).padStart(2, '0')}`;
}

function addMonths(isoString: string, months: number): string {
  const date = new Date(isoString);
  date.setUTCMonth(date.getUTCMonth() + months);
  return date.toISOString();
}

function formatMonthLabel(isoString: string): string {
  const date = new Date(isoString);
  return `${String(date.getUTCMonth() + 1).padStart(2, '0')}月`;
}

export async function calculateDashboardSnapshot(
  db: AssetTrackerDb,
  bookId: string,
  asOf = new Date().toISOString(),
  period: DashboardTrendPeriod = 'month'
): Promise<DashboardSnapshot> {
  const [context, recentTransactions] = await Promise.all([
    loadBalanceContext(db, bookId),
    listTransactionsForBook(db, bookId)
  ]);
  const currentSummary = summarizeBookBalancesAt(context, asOf);
  const previousWeekSummary = summarizeBookBalancesAt(context, addDays(asOf, -7));
  const previousMonthSummary = summarizeBookBalancesAt(context, addDays(asOf, -30));
  const balances = listLeafCategoryBalancesAt(context, asOf);
  const topAssets = balances
    .filter((item) => item.amount > 0)
    .sort((left, right) => right.amount - left.amount)
    .slice(0, 5);
  const topDebts = balances
    .filter((item) => item.kind === 'debt' && item.amount < 0)
    .sort((left, right) => Math.abs(right.amount) - Math.abs(left.amount))
    .slice(0, 5);
  const trend =
    period === 'year'
      ? Array.from({ length: 12 }, (_, index) => {
          const pointAsOf = addMonths(asOf, index - 11);
          const pointSummary = summarizeBookBalancesAt(context, pointAsOf);

          return {
            label: formatMonthLabel(pointAsOf),
            asOf: pointAsOf,
            value: pointSummary.netAmount
          };
        })
      : Array.from({ length: period === 'week' ? 7 : 30 }, (_, index) => {
          const total = period === 'week' ? 7 : 30;
          const pointAsOf = addDays(asOf, index - (total - 1));
          const pointSummary = summarizeBookBalancesAt(context, pointAsOf);

          return {
            label: formatTrendLabel(pointAsOf),
            asOf: pointAsOf,
            value: pointSummary.netAmount
          };
        });
  const selectedPeriodDelta =
    currentSummary.netAmount -
    summarizeBookBalancesAt(context, period === 'week' ? addDays(asOf, -7) : period === 'month' ? addDays(asOf, -30) : addDays(asOf, -365)).netAmount;

  return {
    asOf,
    currentSummary,
    previousWeekSummary,
    previousMonthSummary,
    selectedPeriod: period,
    selectedPeriodLabel: period === 'week' ? '近 7 日' : period === 'month' ? '近 30 日' : '近 12 个月',
    selectedPeriodDelta,
    trend,
    topAssets,
    topDebts,
    recentTransactions: recentTransactions.slice(0, 6),
    memo: context.book.memo
  };
}
