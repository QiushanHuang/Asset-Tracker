import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { createTransactionTemplate } from '../../src/domain/templates/createTransactionTemplate';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { listTransactionsForBook } from '../../src/domain/transactions/listTransactionsForBook';
import { renderTransactionPanel } from '../../src/modules/transactions/renderTransactionPanel';
import { AssetTrackerDb } from '../../src/storage/db';

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('renderTransactionPanel', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-transaction-panel-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
    document.body.innerHTML = '';
  });

  it('uses edited form values after choosing a template instead of forcing the stored template payload', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '餐饮',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const template = await createTransactionTemplate(db, {
      bookId: book.id,
      name: '早餐模板',
      categoryId: category.id,
      amount: 18.8,
      currency: 'CNY',
      direction: 'expense',
      purpose: '早餐',
      description: '固定早餐'
    });
    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderTransactionPanel({ db, book, target });

    const form = target.querySelector<HTMLFormElement>('[data-role="transaction-form"]');

    if (!form) {
      throw new Error('Missing transaction form');
    }

    (form.elements.namedItem('templateId') as HTMLSelectElement).value = template.id;
    (form.elements.namedItem('templateId') as HTMLSelectElement).dispatchEvent(
      new Event('change', { bubbles: true })
    );
    (form.elements.namedItem('amount') as HTMLInputElement).value = '22.50';
    (form.elements.namedItem('purpose') as HTMLInputElement).value = '加量早餐';
    (form.elements.namedItem('occurredAt') as HTMLInputElement).value = '2026-04-13T08:00';

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushAsyncWork();
    await flushAsyncWork();

    const transactions = await listTransactionsForBook(db, book.id);

    expect(transactions).toHaveLength(1);
    expect(transactions[0]?.amount).toBe(-2250);
    expect(transactions[0]?.purpose).toBe('加量早餐');
  });

  it('filters transaction rows by date, category, purpose, direction, and amount sort', async () => {
    const book = await loadOrCreateLocalBook(db);
    const cash = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const card = await createCategory(db, {
      bookId: book.id,
      name: '信用卡',
      parentId: null,
      kind: 'debt',
      currency: 'CNY'
    });

    const target = document.createElement('div');
    document.body.appendChild(target);

    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 5000,
      currency: 'CNY',
      direction: 'income',
      purpose: '工资',
      description: '',
      occurredAt: '2026-04-22T01:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 3000,
      currency: 'CNY',
      direction: 'income',
      purpose: '奖金',
      description: '',
      occurredAt: '2026-04-22T03:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: card.id,
      amount: 120,
      currency: 'CNY',
      direction: 'expense',
      purpose: '午餐',
      description: '',
      occurredAt: '2026-04-21T04:00:00.000Z'
    });

    await renderTransactionPanel({ db, book, target });

    const filterForm = target.querySelector<HTMLFormElement>('[data-role="transaction-filter-form"]');

    if (!filterForm) {
      throw new Error('Missing transaction filter form');
    }

    (filterForm.elements.namedItem('year') as HTMLSelectElement).value = '2026';
    (filterForm.elements.namedItem('month') as HTMLSelectElement).value = '04';
    (filterForm.elements.namedItem('date') as HTMLInputElement).value = '2026-04-22';
    (filterForm.elements.namedItem('categoryId') as HTMLSelectElement).value = cash.id;
    (filterForm.elements.namedItem('purpose') as HTMLInputElement).value = '奖';
    (filterForm.elements.namedItem('direction') as HTMLSelectElement).value = 'income';
    (filterForm.elements.namedItem('sortBy') as HTMLSelectElement).value = 'amount-asc';
    filterForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushAsyncWork();
    await flushAsyncWork();

    const rows = Array.from(target.querySelectorAll('[data-role="transaction-list"] tr'));

    expect(rows).toHaveLength(1);
    expect(rows[0]?.textContent).toContain('奖金');
  });

  it('includes transfer in the direction filter options', async () => {
    const book = await loadOrCreateLocalBook(db);
    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderTransactionPanel({ db, book, target });

    const filterDirection = target.querySelector<HTMLSelectElement>(
      '[data-role="transaction-filter-form"] select[name="direction"]'
    );

    if (!filterDirection) {
      throw new Error('Missing direction filter');
    }

    const optionValues = Array.from(filterDirection.options).map((option) => option.value);

    expect(optionValues).toContain('transfer');
  });
});
