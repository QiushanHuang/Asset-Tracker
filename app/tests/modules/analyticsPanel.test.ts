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

  it('renders historical comparison and trend controls with real anchored data', async () => {
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
    expect(target.textContent).toContain('资产趋势');
    expect(target.textContent).toContain('饼图构成');
    expect(target.textContent).toContain('自定义分析');
    expect(target.textContent).toContain('现金');
    expect(target.textContent).toContain('600.00');
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
});
