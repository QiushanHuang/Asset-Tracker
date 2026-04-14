import { loadBalanceContext, summarizeBookBalancesAt, type BookSummarySnapshot } from '../balances/balanceEngine';
import { AssetTrackerDb } from '../../storage/db';

export type BookSummary = BookSummarySnapshot;

export async function calculateBookSummaryAt(
  db: AssetTrackerDb,
  bookId: string,
  asOf: string
): Promise<BookSummarySnapshot> {
  const context = await loadBalanceContext(db, bookId);

  return summarizeBookBalancesAt(context, asOf);
}
