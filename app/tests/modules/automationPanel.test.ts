import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createAutomationRule } from '../../src/domain/automation/createAutomationRule';
import { listAutomationRulesForBook } from '../../src/domain/automation/listAutomationRulesForBook';
import { toggleAutomationRule } from '../../src/domain/automation/toggleAutomationRule';
import { createCategory } from '../../src/domain/categories/createCategory';
import { renderAutomationPanel } from '../../src/modules/automation/renderAutomationPanel';
import { formatDateForDateInput } from '../../src/shared/utils/datetimeLocal';
import { AssetTrackerDb } from '../../src/storage/db';

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('renderAutomationPanel', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-automation-panel-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
    document.body.innerHTML = '';
  });

  it('keeps paused rules paused when editing them', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '定投',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const rule = await createAutomationRule(db, {
      bookId: book.id,
      name: '每周定投',
      categoryId: category.id,
      amount: 100,
      currency: 'CNY',
      direction: 'expense',
      purpose: '定投',
      description: '自动买入',
      frequency: 'weekly',
      interval: 1,
      startDate: '2026-04-01',
      endDate: null
    });

    await toggleAutomationRule(db, {
      bookId: book.id,
      ruleId: rule.id,
      isActive: false
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    await renderAutomationPanel({ db, book, target });

    const editButton = target.querySelector<HTMLButtonElement>(`[data-action="edit-rule"][data-rule-id="${rule.id}"]`);

    if (!editButton) {
      throw new Error('Missing edit rule button');
    }

    editButton.click();

    const form = target.querySelector<HTMLFormElement>('[data-role="rule-form"]');

    if (!form) {
      throw new Error('Missing rule form');
    }

    (form.elements.namedItem('name') as HTMLInputElement).value = '每周定投-更新';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushAsyncWork();
    await flushAsyncWork();

    const rules = await listAutomationRulesForBook(db, book.id);

    expect(rules).toHaveLength(1);
    expect(rules[0]?.name).toBe('每周定投-更新');
    expect(rules[0]?.isActive).toBe(false);
  });

  it('renders advanced schedule controls for month days, month-end, and time-of-day', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '工资卡',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderAutomationPanel({ db, book, target });

    const form = target.querySelector<HTMLFormElement>('[data-role="rule-form"]');

    if (!form) {
      throw new Error('Missing rule form');
    }

    expect(form.elements.namedItem('monthlyDays')).toBeTruthy();
    expect(form.elements.namedItem('includeLastDayOfMonth')).toBeTruthy();
    expect(form.elements.namedItem('timeOfDay')).toBeTruthy();

    (form.elements.namedItem('name') as HTMLInputElement).value = '工资规则';
    (form.elements.namedItem('categoryId') as HTMLSelectElement).value = category.id;
    (form.elements.namedItem('direction') as HTMLSelectElement).value = 'income';
    (form.elements.namedItem('amount') as HTMLInputElement).value = '5000';
    (form.elements.namedItem('purpose') as HTMLInputElement).value = '工资';
    (form.elements.namedItem('frequency') as HTMLSelectElement).value = 'monthly';
    (form.elements.namedItem('interval') as HTMLInputElement).value = '1';
    (form.elements.namedItem('startDate') as HTMLInputElement).value = '2026-01-01';
    (form.elements.namedItem('monthlyDays') as HTMLInputElement).value = '5,15';
    (form.elements.namedItem('includeLastDayOfMonth') as HTMLInputElement).checked = true;
    (form.elements.namedItem('timeOfDay') as HTMLInputElement).value = '09:30';

    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushAsyncWork();
    await flushAsyncWork();

    const rules = await listAutomationRulesForBook(db, book.id);

    expect(rules).toHaveLength(1);
    expect((rules[0] as any).monthlyDays).toEqual([5, 15]);
    expect((rules[0] as any).includeLastDayOfMonth).toBe(true);
    expect((rules[0] as any).timeOfDay).toBe('09:30');
  });

  it('uses the local calendar date for the default start date', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '工资卡',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    const target = document.createElement('div');
    document.body.appendChild(target);
    await renderAutomationPanel({ db, book, target });

    const form = target.querySelector<HTMLFormElement>('[data-role="rule-form"]');

    if (!form) {
      throw new Error('Missing rule form');
    }

    expect((form.elements.namedItem('startDate') as HTMLInputElement).value).toBe(
      formatDateForDateInput(new Date())
    );
  });
});
