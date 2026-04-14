import { AssetTrackerDb } from '../../storage/db';
import { calculateBookSummaryAt, type BookSummary } from './calculateBookSummaryAt';

export async function calculateBookSummary(
  db: AssetTrackerDb,
  bookId: string
): Promise<BookSummary> {
  return calculateBookSummaryAt(db, bookId, new Date().toISOString());
}
