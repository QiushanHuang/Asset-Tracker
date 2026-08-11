import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { renderApp } from '../../src/app/renderApp';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createAutomationRule } from '../../src/domain/automation/createAutomationRule';
import { createCategory } from '../../src/domain/categories/createCategory';
import { upsertExchangeRate } from '../../src/domain/settings/upsertExchangeRate';
import { createTransactionTemplate } from '../../src/domain/templates/createTransactionTemplate';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { AssetTrackerDb } from '../../src/storage/db';

describe('full feature render', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-full-render-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('renders the legacy section layout with management panels for templates, automation, settings, and import/export', async () => {
    const book = await loadOrCreateLocalBook(db);
    const cnyCategory = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const usdCategory = await createCategory(db, {
      bookId: book.id,
      name: '美元账户',
      parentId: null,
      kind: 'asset',
      currency: 'USD'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: cnyCategory.id,
      amount: 100,
      currency: 'CNY',
      direction: 'income',
      purpose: '初始化',
      description: '启动资金',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });
    await createTransactionTemplate(db, {
      bookId: book.id,
      name: '早餐模板',
      categoryId: cnyCategory.id,
      amount: 18.8,
      currency: 'CNY',
      direction: 'expense',
      purpose: '早餐',
      description: '固定早餐'
    });
    await createAutomationRule(db, {
      bookId: book.id,
      name: '每周定投',
      categoryId: usdCategory.id,
      amount: 100,
      currency: 'USD',
      direction: 'expense',
      purpose: '定投',
      description: '自动买入',
      frequency: 'weekly',
      interval: 1,
      startDate: '2026-04-01',
      endDate: null
    });
    await upsertExchangeRate(db, {
      bookId: book.id,
      currency: 'USD',
      baseCurrency: 'CNY',
      rate: 7.2
    });

    const target = document.createElement('div');
    const sidebar = document.createElement('nav');
    sidebar.innerHTML = `
      <a class="nav-link active" data-section="dashboard"></a>
      <a class="nav-link" data-section="categories"></a>
      <a class="nav-link" data-section="transactions"></a>
      <a class="nav-link" data-section="automation"></a>
      <a class="nav-link" data-section="analytics"></a>
      <a class="nav-link" data-section="settings"></a>
      <a class="nav-link" data-section="import-export"></a>
    `;
    document.body.appendChild(sidebar);

    const sectionTitle = document.createElement('h2');
    sectionTitle.id = 'section-title';
    document.body.appendChild(sectionTitle);

    await renderApp({ db, book, target });

    expect(target.textContent).toContain('模板管理');
    expect(target.textContent).toContain('自动记账规则');
    expect(target.textContent).toContain('汇率设置');
    expect(target.textContent).toContain('导出快照');
    expect(target.textContent).toContain('编辑');
    expect(target.textContent).toContain('删除');
  });
});
