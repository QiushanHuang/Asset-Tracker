import type { Book } from '../../shared/types/entities';
import { AssetTrackerDb } from '../../storage/db';
import { importLegacyAssetTracker } from '../../storage/migrations/importLegacyAssetTracker';

const LEGACY_STORAGE_KEY = 'assetTrackerData';
const LEGACY_AUTO_IMPORT_MARKER_KEY = 'assetTrackerLegacyAutoImportCompleted';

interface LegacyAutoImportMarker {
  bookId: string;
  bookCreatedAt: string;
}

async function hasPersistedBookData(db: AssetTrackerDb, bookId: string): Promise<boolean> {
  const counts = await Promise.all([
    db.categories.where('bookId').equals(bookId).count(),
    db.transactions.where('bookId').equals(bookId).count(),
    db.transactionTemplates.where('bookId').equals(bookId).count(),
    db.automationRules.where('bookId').equals(bookId).count(),
    db.exchangeRates.where('bookId').equals(bookId).count(),
    db.assetStateAnchors.where('bookId').equals(bookId).count()
  ]);

  return counts.some((count) => count > 0);
}

export async function maybeImportLegacyBrowserState(
  db: AssetTrackerDb,
  book: Pick<Book, 'id' | 'createdAt'>
): Promise<boolean> {
  if (typeof window === 'undefined' || !window.localStorage) {
    return false;
  }

  if (await hasPersistedBookData(db, book.id)) {
    return false;
  }

  const marker = window.localStorage.getItem(LEGACY_AUTO_IMPORT_MARKER_KEY);

  if (marker) {
    try {
      const parsedMarker = JSON.parse(marker) as LegacyAutoImportMarker;

      if (parsedMarker.bookId === book.id && parsedMarker.bookCreatedAt === book.createdAt) {
        return false;
      }
    } catch {
      window.localStorage.removeItem(LEGACY_AUTO_IMPORT_MARKER_KEY);
    }
  }

  const payload = window.localStorage.getItem(LEGACY_STORAGE_KEY);

  if (!payload) {
    return false;
  }

  try {
    await importLegacyAssetTracker(db, {
      bookId: book.id,
      payload: JSON.parse(payload)
    });
    window.localStorage.setItem(
      LEGACY_AUTO_IMPORT_MARKER_KEY,
      JSON.stringify({
        bookId: book.id,
        bookCreatedAt: book.createdAt
      } satisfies LegacyAutoImportMarker)
    );
    return true;
  } catch {
    return false;
  }
}
