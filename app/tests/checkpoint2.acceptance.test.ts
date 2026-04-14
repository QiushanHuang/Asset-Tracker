import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '../src/app/renderApp';
import { loadOrCreateLocalBook } from '../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../src/domain/categories/createCategory';
import { createTransaction } from '../src/domain/transactions/createTransaction';
import { AssetTrackerDb } from '../src/storage/db';

describe('checkpoint 2 acceptance', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-checkpoint2');
    await db.delete();
    await db.open();
  });

  it('renders a usable local ledger after creating a category and transaction', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: category.id,
      amount: 100,
      currency: 'CNY',
      direction: 'income',
      purpose: '初始化',
      description: '启动资金',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });

    const target = document.createElement('div');
    await renderApp({ db, book, target });

    expect(target.textContent).toContain('净资产');
    expect(target.textContent).toContain('现金');
    expect(target.textContent).toContain('启动资金');
    expect(target.textContent).toContain('100.00');
  });
});
