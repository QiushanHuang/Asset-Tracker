import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { listAssetStateAnchorsForBook } from '../../src/domain/assetStates/listAssetStateAnchorsForBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { listCategoryTree } from '../../src/domain/categories/listCategoryTree';
import { renderCategoryPanel } from '../../src/modules/categories/renderCategoryPanel';
import { parseDatetimeLocalToIso } from '../../src/shared/utils/datetimeLocal';
import { AssetTrackerDb } from '../../src/storage/db';
import { CategoryRepository } from '../../src/storage/repositories/categoryRepository';

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('renderCategoryPanel', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-category-panel-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
    document.body.innerHTML = '';
  });

  it('submits parent changes when editing a category', async () => {
    const book = await loadOrCreateLocalBook(db);
    const group = await createCategory(db, {
      bookId: book.id,
      name: '总资产',
      parentId: null,
      kind: 'group',
      currency: 'CNY'
    });
    const category = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderCategoryPanel({ db, book, target });

    const editButton = target.querySelector<HTMLButtonElement>(`[data-action="edit"][data-category-id="${category.id}"]`);

    if (!editButton) {
      throw new Error('Missing edit category button');
    }

    editButton.click();

    const form = target.querySelector<HTMLFormElement>('[data-role="category-form"]');

    if (!form) {
      throw new Error('Missing category form');
    }

    (form.elements.namedItem('parentId') as HTMLSelectElement).value = group.id;
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushAsyncWork();
    await flushAsyncWork();

    const tree = await listCategoryTree(db, book.id);
    const updated = tree.find((item) => item.id === category.id);

    expect(updated?.parentId).toBe(group.id);
    expect(updated?.depth).toBe(1);
  });

  it('shows a mixed-currency marker instead of a misleading summed amount for legacy mixed subtrees', async () => {
    const book = await loadOrCreateLocalBook(db);
    const parent = await createCategory(db, {
      bookId: book.id,
      name: '总资产',
      parentId: null,
      kind: 'group',
      currency: 'CNY'
    });
    const child = await createCategory(db, {
      bookId: book.id,
      name: '美元账户',
      parentId: null,
      kind: 'asset',
      currency: 'USD'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: child.id,
      amount: 100,
      currency: 'USD',
      direction: 'income',
      purpose: '入账',
      description: '',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });

    const repository = new CategoryRepository(db);
    const persistedChild = await repository.get(child.id);

    if (!persistedChild) {
      throw new Error('Missing child category');
    }

    await repository.put({
      ...persistedChild,
      parentId: parent.id,
      sortOrder: 0,
      revision: persistedChild.revision + 1,
      updatedAt: '2026-04-13T00:05:00.000Z'
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    await renderCategoryPanel({ db, book, target });

    expect(target.textContent).toContain('多币种');
  });

  it('submits an asset-state anchor from the category panel', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderCategoryPanel({ db, book, target });

    const form = target.querySelector<HTMLFormElement>('[data-role="asset-state-form"]');

    if (!form) {
      throw new Error('Missing asset state form');
    }

    (form.elements.namedItem('categoryId') as HTMLSelectElement).value = category.id;
    (form.elements.namedItem('anchoredAt') as HTMLInputElement).value = '2026-04-13T08:00';
    (form.elements.namedItem('amount') as HTMLInputElement).value = '1234.56';
    (form.elements.namedItem('note') as HTMLInputElement).value = '早盘盘点';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushAsyncWork();
    await flushAsyncWork();

    const anchors = await listAssetStateAnchorsForBook(db, book.id);

    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.amount).toBe(123456);
    expect(anchors[0]?.note).toBe('早盘盘点');

    await renderCategoryPanel({ db, book, target });

    expect(target.textContent).toContain('2026-04-13 08:00');
  });

  it('loads an existing asset-state anchor into edit mode and persists the updated snapshot', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderCategoryPanel({ db, book, target });

    const createForm = target.querySelector<HTMLFormElement>('[data-role="asset-state-form"]');

    if (!createForm) {
      throw new Error('Missing asset state form');
    }

    (createForm.elements.namedItem('categoryId') as HTMLSelectElement).value = category.id;
    (createForm.elements.namedItem('anchoredAt') as HTMLInputElement).value = '2026-04-13T08:00';
    (createForm.elements.namedItem('amount') as HTMLInputElement).value = '1234.56';
    (createForm.elements.namedItem('note') as HTMLInputElement).value = '早盘盘点';
    createForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushAsyncWork();
    await flushAsyncWork();

    await renderCategoryPanel({ db, book, target });

    const editButton = target.querySelector<HTMLButtonElement>('[data-action="edit-anchor"]');

    if (!editButton) {
      throw new Error('Missing edit anchor button');
    }

    editButton.click();

    const form = target.querySelector<HTMLFormElement>('[data-role="asset-state-form"]');

    if (!form) {
      throw new Error('Missing asset state form after edit');
    }

    expect((form.elements.namedItem('anchoredAt') as HTMLInputElement).value).toBe('2026-04-13T08:00');
    expect((form.elements.namedItem('amount') as HTMLInputElement).value).toBe('1234.56');
    expect((form.elements.namedItem('note') as HTMLInputElement).value).toBe('早盘盘点');

    (form.elements.namedItem('anchoredAt') as HTMLInputElement).value = '2026-04-13T10:15';
    (form.elements.namedItem('amount') as HTMLInputElement).value = '1500.00';
    (form.elements.namedItem('note') as HTMLInputElement).value = '午间复盘';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushAsyncWork();
    await flushAsyncWork();

    const anchors = await listAssetStateAnchorsForBook(db, book.id);

    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.amount).toBe(150000);
    expect(anchors[0]?.note).toBe('午间复盘');
    expect(anchors[0]?.anchoredAt).toBe(parseDatetimeLocalToIso('2026-04-13T10:15'));
  });

  it('renders overpaid debt balances as positive values while keeping the debt label', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '信用卡',
      parentId: null,
      kind: 'debt',
      currency: 'CNY'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: category.id,
      amount: 100,
      currency: 'CNY',
      direction: 'income',
      purpose: '退款',
      description: '',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    await renderCategoryPanel({ db, book, target });

    expect(target.textContent).toContain('负债');
    expect(target.querySelector('.category-subtitle .positive')?.textContent).toContain('100.00');
  });
});
