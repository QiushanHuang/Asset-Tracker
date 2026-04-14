import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { renderImportExportPanel } from '../../src/modules/importExport/renderImportExportPanel';
import { downloadTextFile } from '../../src/shared/utils/downloadTextFile';
import { AssetTrackerDb } from '../../src/storage/db';

vi.mock('../../src/shared/utils/downloadTextFile', () => ({
  downloadTextFile: vi.fn()
}));

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('renderImportExportPanel', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-import-export-panel-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
    vi.mocked(downloadTextFile).mockClear();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
    document.body.innerHTML = '';
  });

  it('does not multiply export handlers when the panel rerenders on the same target', async () => {
    const book = await loadOrCreateLocalBook(db);
    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderImportExportPanel({ db, book, target });
    await renderImportExportPanel({ db, book, target });

    target
      .querySelector<HTMLButtonElement>('[data-action="export-json"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();
    await flushAsyncWork();

    expect(downloadTextFile).toHaveBeenCalledTimes(1);
  });

  it('escapes quoted CSV fields across category, purpose, and description', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: 'Cash "A"',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: category.id,
      amount: 12.34,
      currency: 'CNY',
      direction: 'income',
      purpose: 'Salary "Bonus"',
      description: 'note "quoted"',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });

    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderImportExportPanel({ db, book, target });
    target
      .querySelector<HTMLButtonElement>('[data-action="export-csv"]')
      ?.dispatchEvent(new MouseEvent('click', { bubbles: true }));
    await flushAsyncWork();
    await flushAsyncWork();

    const csvPayload = vi.mocked(downloadTextFile).mock.calls[0]?.[1];

    expect(csvPayload).toContain('"Cash ""A"""');
    expect(csvPayload).toContain('"Salary ""Bonus"""');
    expect(csvPayload).toContain('"note ""quoted"""');
  });
});
