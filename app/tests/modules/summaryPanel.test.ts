import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { renderSummaryPanel } from '../../src/modules/dashboard/renderSummaryPanel';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { AssetTrackerDb } from '../../src/storage/db';

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('renderSummaryPanel', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-summary-panel-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
    document.body.innerHTML = '';
  });

  it('shows richer overview cards and lets the user persist a dashboard memo', async () => {
    const book = await loadOrCreateLocalBook(db);
    const cash = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const debt = await createCategory(db, {
      bookId: book.id,
      name: '信用卡',
      parentId: null,
      kind: 'debt',
      currency: 'CNY'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 3000,
      currency: 'CNY',
      direction: 'income',
      purpose: '工资',
      description: '',
      occurredAt: '2026-04-13T09:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: debt.id,
      amount: 1200,
      currency: 'CNY',
      direction: 'expense',
      purpose: '刷卡',
      description: '',
      occurredAt: '2026-04-13T10:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 88,
      currency: 'CNY',
      direction: 'expense',
      purpose: '午餐',
      description: '最近账单',
      occurredAt: '2026-04-13T12:00:00.000Z'
    });

    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderSummaryPanel({
      db,
      book,
      target,
      onChange: async () => {
        const latestBook = await db.books.get(book.id);

        if (!latestBook) {
          throw new Error('Missing latest book');
        }

        await renderSummaryPanel({ db, book: latestBook, target });
      }
    } as any);

    expect(target.textContent).toContain('资产总览');
    expect(target.textContent).toContain('总资产变化');
    expect(target.textContent).toContain('图表概况');
    expect(target.textContent).toContain('最近账单');
    expect(target.textContent).toContain('午餐');
    expect(target.querySelector('[data-role="dashboard-period"]')).not.toBeNull();
    expect(target.querySelectorAll('[data-role="dashboard-grid-line"]').length).toBeGreaterThan(0);
    expect(target.querySelectorAll('[data-role="dashboard-y-axis-label"]').length).toBeGreaterThan(0);

    const assetValue = target.querySelector<HTMLElement>('[data-summary-kind="asset"] .value');
    const debtValue = target.querySelector<HTMLElement>('[data-summary-kind="debt"] .value');

    expect(assetValue?.className).toContain('summary-value--asset');
    expect(debtValue?.className).toContain('negative');

    const memoForm = target.querySelector<HTMLFormElement>('[data-role="summary-memo-form"]');

    if (!memoForm) {
      throw new Error('Missing summary memo form');
    }

    (memoForm.elements.namedItem('memo') as HTMLTextAreaElement).value = '工资到账后记得转储蓄。';
    memoForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushAsyncWork();
    await flushAsyncWork();

    const latestBook = await db.books.get(book.id);

    expect((latestBook as any)?.memo).toBe('工资到账后记得转储蓄。');
  });
});
