import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '../../src/app/renderApp';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { AssetTrackerDb } from '../../src/storage/db';

describe('renderApp', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-render-app');
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('mounts summary, categories, and transactions panels for the local book', async () => {
    const target = document.createElement('div');
    const book = await loadOrCreateLocalBook(db);

    await renderApp({
      db,
      book,
      target
    });

    expect(target.querySelector('#dashboard [data-panel="summary"]')).not.toBeNull();
    expect(target.querySelector('#categories [data-panel="categories"]')).not.toBeNull();
    expect(target.querySelector('#transactions [data-panel="transactions"]')).not.toBeNull();
  });

  it('escapes user-provided names and descriptions before rendering', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '<img src=x onerror=alert(1)>',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: category.id,
      amount: 10,
      currency: 'CNY',
      direction: 'income',
      purpose: '<b>purpose</b>',
      description: '<script>alert(1)</script>',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });

    const target = document.createElement('div');
    await renderApp({ db, book, target });

    expect(target.querySelector('img')).toBeNull();
    expect(target.querySelector('script')).toBeNull();
    expect(target.querySelector('b')).toBeNull();
    expect(target.textContent).toContain('<img src=x onerror=alert(1)>');
    expect(target.textContent).toContain('<script>alert(1)</script>');
  });
});
