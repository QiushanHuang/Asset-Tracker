import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { createAutomationRule } from '../../src/domain/automation/createAutomationRule';
import { renderAnalyticsPanel } from '../../src/modules/analytics/renderAnalyticsPanel';
import { createAssetStateAnchor } from '../../src/domain/assetStates/createAssetStateAnchor';
import { upsertExchangeRate } from '../../src/domain/settings/upsertExchangeRate';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { AssetTrackerDb } from '../../src/storage/db';

function flushAsyncWork(): Promise<void> {
  return new Promise((resolve) => {
    setTimeout(resolve, 0);
  });
}

describe('renderAnalyticsPanel', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-analytics-panel-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
    document.body.innerHTML = '';
  });

  it('renders richer analytics controls, balanced analytics rows, and default-collapsed tree snapshots', async () => {
    const book = await loadOrCreateLocalBook(db);
    const walletGroup = await createCategory(db, {
      bookId: book.id,
      name: '钱包资产',
      parentId: null,
      kind: 'group',
      currency: 'CNY'
    });
    const cash = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: walletGroup.id,
      kind: 'asset',
      currency: 'CNY'
    });
    const savings = await createCategory(db, {
      bookId: book.id,
      name: '储蓄',
      parentId: walletGroup.id,
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

    await createAssetStateAnchor(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 500,
      currency: 'CNY',
      anchoredAt: '2026-04-10T09:00:00.000Z',
      note: '对账'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 100,
      currency: 'CNY',
      direction: 'income',
      purpose: '工资',
      description: '',
      occurredAt: '2026-04-11T09:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: savings.id,
      amount: 300,
      currency: 'CNY',
      direction: 'income',
      purpose: '转入储蓄',
      description: '',
      occurredAt: '2026-04-01T09:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: debt.id,
      amount: 150,
      currency: 'CNY',
      direction: 'expense',
      purpose: '卡账消费',
      description: '',
      occurredAt: '2026-04-12T09:00:00.000Z'
    });

    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderAnalyticsPanel({
      db,
      book,
      target,
      now: '2026-04-13T00:00:00.000Z'
    });

    expect(target.textContent).toContain('图表配置');
    expect(target.textContent).toContain('历史资产对比');
    expect(target.textContent).toContain('收入分析');
    expect(target.textContent).toContain('支出分析');
    expect(target.textContent).toContain('净收入分析');
    expect(target.textContent).toContain('日均收入');
    expect(target.textContent).toContain('日均支出');
    expect(target.textContent).toContain('饼图构成');
    expect(target.textContent).not.toContain('资产状态时间线');
    expect(target.textContent).toContain('现金');
    expect(target.textContent).toContain('600.00');
    expect(target.querySelector('[data-role="analytics-config"]')).not.toBeNull();
    expect(target.querySelector('[data-role="historical-comparison"]')).not.toBeNull();
    expect(target.querySelector('[data-role="analysis-preset"] option[value="year"]')).not.toBeNull();
    expect(target.querySelector('[data-role="analysis-preset"] option[value="custom"]')).not.toBeNull();
    expect(target.querySelector('[data-role="income-average"]')).not.toBeNull();
    expect(target.querySelector('[data-role="expense-average"]')).not.toBeNull();
    expect(target.querySelector('[data-role="composition-mode"] option[value="asset"]')).not.toBeNull();
    expect(target.querySelector('[data-role="composition-mode"] option[value="income"]')).not.toBeNull();
    expect(target.querySelector('[data-role="composition-mode"] option[value="expense"]')).not.toBeNull();
    expect(target.querySelector('[data-role="composition-preset"] option[value="day"]')).not.toBeNull();
    expect(target.querySelector('[data-role="composition-preset"] option[value="week"]')).not.toBeNull();
    expect(target.querySelector('[data-role="composition-preset"] option[value="month"]')).not.toBeNull();
    expect(target.querySelector('[data-role="composition-preset"] option[value="year"]')).not.toBeNull();
    expect(target.querySelector('[data-role="composition-preset"] option[value="custom"]')).not.toBeNull();
    expect(target.querySelector<HTMLSelectElement>('[data-role="composition-preset"]')?.disabled).toBe(
      true
    );
    expect(target.querySelectorAll('[data-role="composition-pie"]').length).toBe(3);
    expect(target.querySelector('details[data-role="tree-node"]')).not.toBeNull();
    expect(target.querySelector('[data-role="expand-tree-all"]')).not.toBeNull();
    expect(target.querySelector('[data-role="collapse-tree-all"]')).not.toBeNull();
    expect(target.querySelector('[data-role="forecast-balance-row"]')).not.toBeNull();
    expect(target.querySelector('[data-role="composition-balance-row"]')).not.toBeNull();
    expect(target.querySelector('[data-role="snapshot-balance-row"]')).not.toBeNull();

    const configCard = target.querySelector<HTMLElement>('[data-role="analytics-config"]');
    const historyCard = target.querySelector<HTMLElement>('[data-role="historical-comparison"]');
    const forecastRow = target.querySelector<HTMLElement>('[data-role="forecast-balance-row"]');
    const compositionRow = target.querySelector<HTMLElement>('[data-role="composition-balance-row"]');
    const snapshotRow = target.querySelector<HTMLElement>('[data-role="snapshot-balance-row"]');
    const pieCard = target.querySelector<HTMLElement>('[data-role="pie-compositions-card"]');
    const heatmapCard = target.querySelector<HTMLElement>('[data-role="cashflow-heatmap-card"]');
    const compositionCard = target.querySelector<HTMLElement>('[data-role="category-composition-card"]');
    const radarCard = target.querySelector<HTMLElement>('[data-role="radar-card"]');
    const insightCard = target.querySelector<HTMLElement>('[data-role="custom-insights-card"]');
    const treeSnapshotCard = target.querySelector<HTMLElement>('[data-role="tree-snapshot-card"]');
    const snapshotSideStack = target.querySelector<HTMLElement>('[data-role="snapshot-side-stack"]');

    if (
      !configCard ||
      !historyCard ||
      !forecastRow ||
      !compositionRow ||
      !snapshotRow ||
      !pieCard ||
      !heatmapCard ||
      !compositionCard ||
      !radarCard ||
      !insightCard ||
      !treeSnapshotCard ||
      !snapshotSideStack
    ) {
      throw new Error('Missing analytics cards');
    }

    expect(configCard.compareDocumentPosition(historyCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(forecastRow.contains(pieCard)).toBe(true);
    expect(compositionRow.contains(heatmapCard)).toBe(true);
    expect(compositionRow.contains(compositionCard)).toBe(true);
    expect(snapshotRow.contains(snapshotSideStack)).toBe(true);
    expect(snapshotRow.contains(treeSnapshotCard)).toBe(true);
    expect(snapshotSideStack.contains(radarCard)).toBe(true);
    expect(snapshotSideStack.contains(insightCard)).toBe(true);
    expect(forecastRow.compareDocumentPosition(compositionRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(compositionRow.compareDocumentPosition(snapshotRow) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(heatmapCard.compareDocumentPosition(compositionCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(radarCard.compareDocumentPosition(insightCard) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();

    const compositionForm = target.querySelector<HTMLFormElement>('[data-role="composition-controls"]');

    if (!compositionForm) {
      throw new Error('Missing composition controls');
    }

    (compositionForm.elements.namedItem('compositionMode') as HTMLSelectElement).value = 'expense';
    (compositionForm.elements.namedItem('compositionPreset') as HTMLSelectElement).value = 'month';
    compositionForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushAsyncWork();
    await flushAsyncWork();

    expect(target.querySelector<HTMLSelectElement>('[data-role="composition-mode"]')?.value).toBe('expense');
    expect(target.querySelector<HTMLSelectElement>('[data-role="composition-preset"]')?.disabled).toBe(
      false
    );
    expect(target.textContent).toContain('信用卡');
    expect(target.textContent).toContain('150.00');

    const treeNode = target.querySelector<HTMLDetailsElement>('details[data-role="tree-node"]');
    const expandTreeButton = target.querySelector<HTMLButtonElement>('[data-role="expand-tree-all"]');
    const collapseTreeButton = target.querySelector<HTMLButtonElement>('[data-role="collapse-tree-all"]');

    if (!treeNode || !expandTreeButton || !collapseTreeButton) {
      throw new Error('Missing tree controls');
    }

    expect(treeNode.open).toBe(false);

    expandTreeButton.click();
    await flushAsyncWork();

    expect(target.querySelector<HTMLDetailsElement>('details[data-role="tree-node"]')?.open).toBe(true);

    target.querySelector<HTMLButtonElement>('[data-role="collapse-tree-all"]')?.click();
    await flushAsyncWork();

    const analyticsForm = target.querySelector<HTMLFormElement>('[data-role="analytics-form"]');

    if (!analyticsForm) {
      throw new Error('Missing analytics form');
    }

    analyticsForm.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));
    await flushAsyncWork();
    await flushAsyncWork();

    expect(target.querySelector<HTMLDetailsElement>('details[data-role="tree-node"]')?.open).toBe(false);
  });

  it('shows a friendly error instead of throwing when datetime filters are cleared', async () => {
    const book = await loadOrCreateLocalBook(db);
    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderAnalyticsPanel({
      db,
      book,
      target,
      now: '2026-04-13T00:00:00.000Z'
    });

    expect(target.textContent).not.toContain('-0.01');

    const form = target.querySelector<HTMLFormElement>('[data-role="analytics-form"]');

    if (!form) {
      throw new Error('Missing analytics form');
    }

    (form.elements.namedItem('asOf') as HTMLInputElement).value = '';
    (form.elements.namedItem('compareAt') as HTMLInputElement).value = '';
    form.dispatchEvent(new Event('submit', { bubbles: true, cancelable: true }));

    await Promise.resolve();
    await Promise.resolve();

    expect(target.textContent).toContain('请选择完整的分析时间');
  });

  it('renders forecast and richer chart cards using active automation rules', async () => {
    const book = await loadOrCreateLocalBook(db);
    const cash = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    await createAssetStateAnchor(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 1000,
      currency: 'CNY',
      anchoredAt: '2026-04-10T09:00:00.000Z',
      note: '盘点'
    });
    await createAutomationRule(db, {
      bookId: book.id,
      name: '月薪',
      categoryId: cash.id,
      amount: 5000,
      currency: 'CNY',
      direction: 'income',
      purpose: '工资',
      description: '每月工资',
      frequency: 'monthly',
      interval: 1,
      startDate: '2026-04-15',
      endDate: null,
      monthlyDays: [15],
      timeOfDay: '09:00'
    } as any);

    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderAnalyticsPanel({
      db,
      book,
      target,
      now: '2026-04-13T00:00:00.000Z'
    });

    expect(target.textContent).toContain('未来预计曲线');
    expect(target.textContent).toContain('周期现金流热区');
    expect(target.textContent).toContain('结构分布雷达');
    expect(target.querySelectorAll('[data-role="axis-tick"]').length).toBeGreaterThan(0);
    expect(
      Array.from(target.querySelectorAll<HTMLElement>('[data-role="axis-tick"]')).every((item) =>
        item.getAttribute('style')?.includes('%') ||
        item.getAttribute('style')?.includes('left:0') ||
        item.getAttribute('style')?.includes('right:0')
      )
    ).toBe(true);
  });

  it('renders overpaid debt balances as positive assets inside analytics views', async () => {
    const book = await loadOrCreateLocalBook(db);
    const card = await createCategory(db, {
      bookId: book.id,
      name: '信用卡',
      parentId: null,
      kind: 'debt',
      currency: 'CNY'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: card.id,
      amount: 200,
      currency: 'CNY',
      direction: 'income',
      purpose: '退款',
      description: '',
      occurredAt: '2026-04-13T08:00:00.000Z'
    });

    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderAnalyticsPanel({
      db,
      book,
      target,
      now: '2026-04-13T09:00:00.000Z'
    });

    expect(target.textContent).toContain('信用卡');
    expect(target.querySelector('.analytics-category-item strong.positive')?.textContent).toContain('200.00');
  });

  it('offers a historical exchange-rate entry form when comparison data is missing rates', async () => {
    const book = await loadOrCreateLocalBook(db);
    const usd = await createCategory(db, {
      bookId: book.id,
      name: '美元账户',
      parentId: null,
      kind: 'asset',
      currency: 'USD'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: usd.id,
      amount: 100,
      currency: 'USD',
      direction: 'income',
      purpose: '美元入账',
      description: '',
      occurredAt: '2026-04-13T08:00:00.000Z'
    });

    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderAnalyticsPanel({
      db,
      book,
      target,
      now: '2026-04-14T09:00:00.000Z'
    });

    expect(target.textContent).toContain('补充历史汇率');
    expect(target.querySelector('[data-role="historical-rate-form"]')).not.toBeNull();
  });

  it('renders converted comparison values after saving a dated historical rate', async () => {
    const book = await loadOrCreateLocalBook(db);
    const usd = await createCategory(db, {
      bookId: book.id,
      name: '美元账户',
      parentId: null,
      kind: 'asset',
      currency: 'USD'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: usd.id,
      amount: 100,
      currency: 'USD',
      direction: 'income',
      purpose: '美元入账',
      description: '',
      occurredAt: '2026-04-13T08:00:00.000Z'
    });
    await upsertExchangeRate(db, {
      bookId: book.id,
      currency: 'USD',
      baseCurrency: 'CNY',
      rate: 7.1,
      effectiveFrom: '2026-03-13'
    });

    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderAnalyticsPanel({
      db,
      book,
      target,
      now: '2026-04-14T09:00:00.000Z'
    });

    expect(target.querySelector('[data-role="historical-rate-form"]')).toBeNull();
    expect(target.textContent).toContain('710.00');
    expect(target.textContent).toContain('0.00');
  });

  it('shows legend entries for every pie slice when there are more than six categories', async () => {
    const book = await loadOrCreateLocalBook(db);

    for (const index of Array.from({ length: 7 }, (_, item) => item + 1)) {
      const category = await createCategory(db, {
        bookId: book.id,
        name: `资产${index}`,
        parentId: null,
        kind: 'asset',
        currency: 'CNY'
      });

      await createTransaction(db, {
        bookId: book.id,
        categoryId: category.id,
        amount: index * 100,
        currency: 'CNY',
        direction: 'income',
        purpose: `入账${index}`,
        description: '',
        occurredAt: '2026-04-10T09:00:00.000Z'
      });
    }

    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderAnalyticsPanel({
      db,
      book,
      target,
      now: '2026-04-13T00:00:00.000Z'
    });

    const assetPieCard = target
      .querySelector<HTMLElement>('[data-mode="asset"]')
      ?.closest<HTMLElement>('.analytics-pie-card');

    if (!assetPieCard) {
      throw new Error('Missing asset pie card');
    }

    const legendItems = assetPieCard.querySelectorAll('.analytics-legend-item');

    expect(legendItems).toHaveLength(7);
    expect(assetPieCard.textContent).toContain('资产7');
  });

  it('uses transaction purposes for income and expense pie compositions', async () => {
    const book = await loadOrCreateLocalBook(db);
    const cash = await createCategory(db, {
      bookId: book.id,
      name: '现金账户',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 200,
      currency: 'CNY',
      direction: 'income',
      purpose: '工资',
      description: '',
      occurredAt: '2026-04-10T09:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 120,
      currency: 'CNY',
      direction: 'income',
      purpose: '奖金',
      description: '',
      occurredAt: '2026-04-11T09:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 80,
      currency: 'CNY',
      direction: 'expense',
      purpose: '餐饮',
      description: '',
      occurredAt: '2026-04-12T09:00:00.000Z'
    });

    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderAnalyticsPanel({
      db,
      book,
      target,
      now: '2026-04-13T00:00:00.000Z'
    });

    const incomePieCard = target
      .querySelector<HTMLElement>('[data-mode="income"]')
      ?.closest<HTMLElement>('.analytics-pie-card');
    const expensePieCard = target
      .querySelector<HTMLElement>('[data-mode="expense"]')
      ?.closest<HTMLElement>('.analytics-pie-card');

    if (!incomePieCard || !expensePieCard) {
      throw new Error('Missing income or expense pie card');
    }

    expect(incomePieCard.textContent).toContain('工资');
    expect(incomePieCard.textContent).toContain('奖金');
    expect(incomePieCard.textContent).not.toContain('现金账户');
    expect(expensePieCard.textContent).toContain('餐饮');
  });
});
