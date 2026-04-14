import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createAssetStateAnchor } from '../../src/domain/assetStates/createAssetStateAnchor';
import { fillAutomationRuleToDate } from '../../src/domain/automation/fillAutomationRuleToDate';
import { createAutomationRule } from '../../src/domain/automation/createAutomationRule';
import { createCategory } from '../../src/domain/categories/createCategory';
import { exportBookSnapshot } from '../../src/domain/importExport/exportBookSnapshot';
import { importBookSnapshot } from '../../src/domain/importExport/importBookSnapshot';
import { upsertExchangeRate } from '../../src/domain/settings/upsertExchangeRate';
import { applyTransactionTemplate } from '../../src/domain/templates/applyTransactionTemplate';
import { createTransactionTemplate } from '../../src/domain/templates/createTransactionTemplate';
import { listTransactionsForBook } from '../../src/domain/transactions/listTransactionsForBook';
import { updateTransaction } from '../../src/domain/transactions/updateTransaction';
import { parseDateAndTimeToIso } from '../../src/shared/utils/datetimeLocal';
import { AssetTrackerDb } from '../../src/storage/db';

describe('templates, automation, and snapshot import/export', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-template-automation-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('applies a saved template into a concrete transaction', async () => {
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

    const transaction = await applyTransactionTemplate(db, {
      bookId: book.id,
      templateId: template.id,
      occurredAt: '2026-04-13T08:00:00.000Z'
    });

    expect(transaction.amount).toBe(-1880);
    expect(transaction.purpose).toBe('早餐');
  });

  it('preserves negative adjustment values when applying a template', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const template = await createTransactionTemplate(db, {
      bookId: book.id,
      name: '手工调减',
      categoryId: category.id,
      amount: -25,
      currency: 'CNY',
      direction: 'adjustment',
      purpose: '校准',
      description: '负向调整'
    });

    const transaction = await applyTransactionTemplate(db, {
      bookId: book.id,
      templateId: template.id,
      occurredAt: '2026-04-13T09:00:00.000Z'
    });

    expect(transaction.amount).toBe(-2500);
    expect(transaction.direction).toBe('adjustment');
  });

  it('fills an automation rule to a target date without creating duplicates', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '房租',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const rule = await createAutomationRule(db, {
      bookId: book.id,
      name: '月租',
      categoryId: category.id,
      amount: 2500,
      currency: 'CNY',
      direction: 'expense',
      purpose: '房租',
      description: '固定房租',
      frequency: 'monthly',
      interval: 1,
      startDate: '2026-01-01',
      endDate: null
    });

    const createdFirstPass = await fillAutomationRuleToDate(db, {
      bookId: book.id,
      ruleId: rule.id,
      throughDate: '2026-03-15'
    });
    const createdSecondPass = await fillAutomationRuleToDate(db, {
      bookId: book.id,
      ruleId: rule.id,
      throughDate: '2026-03-15'
    });

    expect(createdFirstPass).toHaveLength(3);
    expect(createdSecondPass).toHaveLength(0);
    expect((await listTransactionsForBook(db, book.id)).map((item) => item.purpose)).toEqual([
      '房租',
      '房租',
      '房租'
    ]);
  });

  it('does not recreate an automation occurrence after the generated transaction is edited', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '定投账户',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const rule = await createAutomationRule(db, {
      bookId: book.id,
      name: '每月定投',
      categoryId: category.id,
      amount: 500,
      currency: 'CNY',
      direction: 'expense',
      purpose: '定投',
      description: '自动定投',
      frequency: 'monthly',
      interval: 1,
      startDate: '2026-01-01',
      endDate: null
    });

    const createdFirstPass = await fillAutomationRuleToDate(db, {
      bookId: book.id,
      ruleId: rule.id,
      throughDate: '2026-01-31'
    });

    expect(createdFirstPass).toHaveLength(1);

    await updateTransaction(db, {
      bookId: book.id,
      transactionId: createdFirstPass[0]!.id,
      categoryId: category.id,
      amount: 500,
      currency: 'CNY',
      direction: 'expense',
      purpose: '手工确认定投',
      description: '用户补充备注',
      occurredAt: '2026-01-03T09:00:00.000Z'
    });

    const createdSecondPass = await fillAutomationRuleToDate(db, {
      bookId: book.id,
      ruleId: rule.id,
      throughDate: '2026-01-31'
    });

    expect(createdSecondPass).toHaveLength(0);
    expect(await listTransactionsForBook(db, book.id)).toHaveLength(1);
  });

  it('preserves month-end occurrences when backfilling monthly automation rules', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '月末结算',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const rule = await createAutomationRule(db, {
      bookId: book.id,
      name: '月底规则',
      categoryId: category.id,
      amount: 100,
      currency: 'CNY',
      direction: 'expense',
      purpose: '结算',
      description: '月末扣减',
      frequency: 'monthly',
      interval: 1,
      startDate: '2026-01-31',
      endDate: null
    });

    const created = await fillAutomationRuleToDate(db, {
      bookId: book.id,
      ruleId: rule.id,
      throughDate: '2026-03-01'
    });

    expect(created.map((item) => item.automationOccurrenceDate)).toEqual(['2026-01-31', '2026-02-28']);
  });

  it('supports monthly rules scheduled on explicit month days', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '工资账户',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const rule = await createAutomationRule(db, {
      bookId: book.id,
      name: '半月工资',
      categoryId: category.id,
      amount: 1000,
      currency: 'CNY',
      direction: 'income',
      purpose: '工资',
      description: '固定工资',
      frequency: 'monthly',
      interval: 1,
      startDate: '2026-01-05',
      endDate: null,
      monthlyDays: [5, 15]
    } as any);

    const created = await fillAutomationRuleToDate(db, {
      bookId: book.id,
      ruleId: rule.id,
      throughDate: '2026-02-20'
    });

    expect(created.map((item) => item.automationOccurrenceDate)).toEqual([
      '2026-01-05',
      '2026-01-15',
      '2026-02-05',
      '2026-02-15'
    ]);
  });

  it('supports month-end automation rules without drifting off the last day', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '信用卡还款',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const rule = await createAutomationRule(db, {
      bookId: book.id,
      name: '月底还款',
      categoryId: category.id,
      amount: 500,
      currency: 'CNY',
      direction: 'expense',
      purpose: '还款',
      description: '每月最后一日',
      frequency: 'monthly',
      interval: 1,
      startDate: '2026-01-01',
      endDate: null,
      includeLastDayOfMonth: true
    } as any);

    const created = await fillAutomationRuleToDate(db, {
      bookId: book.id,
      ruleId: rule.id,
      throughDate: '2026-03-02'
    });

    expect(created.map((item) => item.automationOccurrenceDate)).toEqual([
      '2026-01-31',
      '2026-02-28'
    ]);
  });

  it('applies configured time-of-day when generating daily automation occurrences', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '工资卡',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const rule = await createAutomationRule(db, {
      bookId: book.id,
      name: '每日利息',
      categoryId: category.id,
      amount: 10,
      currency: 'CNY',
      direction: 'income',
      purpose: '利息',
      description: '每日入账',
      frequency: 'daily',
      interval: 1,
      startDate: '2026-01-01',
      endDate: null,
      timeOfDay: '09:30'
    } as any);

    const created = await fillAutomationRuleToDate(db, {
      bookId: book.id,
      ruleId: rule.id,
      throughDate: '2026-01-02'
    });

    expect(created.map((item) => item.occurredAt)).toEqual([
      parseDateAndTimeToIso('2026-01-01', '09:30'),
      parseDateAndTimeToIso('2026-01-02', '09:30')
    ]);
  });

  it('round-trips templates, automation rules, exchange rates, and transactions through snapshot import/export', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '美元账户',
      parentId: null,
      kind: 'asset',
      currency: 'USD'
    });
    const template = await createTransactionTemplate(db, {
      bookId: book.id,
      name: '美股买入',
      categoryId: category.id,
      amount: 500,
      currency: 'USD',
      direction: 'expense',
      purpose: '建仓',
      description: '定投'
    });

    await applyTransactionTemplate(db, {
      bookId: book.id,
      templateId: template.id,
      occurredAt: '2026-04-13T08:00:00.000Z'
    });
    await createAutomationRule(db, {
      bookId: book.id,
      name: '每周定投',
      categoryId: category.id,
      amount: 100,
      currency: 'USD',
      direction: 'expense',
      purpose: '定投',
      description: '每周自动买入',
      frequency: 'weekly',
      interval: 1,
      startDate: '2026-04-01',
      endDate: null
    });
    await upsertExchangeRate(db, {
      bookId: book.id,
      currency: 'USD',
      baseCurrency: 'CNY',
      rate: 7.2,
      effectiveFrom: '2026-04-13'
    });
    await createAssetStateAnchor(db, {
      bookId: book.id,
      categoryId: category.id,
      amount: 1200,
      currency: 'USD',
      anchoredAt: '2026-04-12T00:00:00.000Z',
      note: '阶段盘点'
    });

    const snapshot = await exportBookSnapshot(db, book.id);

    const importedDb = new AssetTrackerDb(`asset-tracker-imported-${crypto.randomUUID()}`);
    await importedDb.delete();
    await importedDb.open();
    const importedBook = await loadOrCreateLocalBook(importedDb);

    await importBookSnapshot(importedDb, {
      bookId: importedBook.id,
      payload: snapshot
    });

    const parsed = JSON.parse(await exportBookSnapshot(importedDb, importedBook.id)) as {
      transactionTemplates: Array<{ name: string }>;
      automationRules: Array<{ name: string }>;
      exchangeRates: Array<{ currency: string; rate: number }>;
      transactions: Array<{ purpose: string }>;
      assetStateAnchors: Array<{ note: string; amount: number }>;
    };

    expect(parsed.transactionTemplates).toHaveLength(1);
    expect(parsed.transactionTemplates[0]?.name).toBe('美股买入');
    expect(parsed.automationRules).toHaveLength(1);
    expect(parsed.automationRules[0]?.name).toBe('每周定投');
    expect(parsed.exchangeRates).toEqual([
      { currency: 'USD', rate: 7.2, effectiveFrom: '2026-04-13' }
    ]);
    expect(parsed.transactions).toHaveLength(1);
    expect(parsed.transactions[0]?.purpose).toBe('建仓');
    expect(parsed.assetStateAnchors).toHaveLength(1);
    expect(parsed.assetStateAnchors[0]?.note).toBe('阶段盘点');
    expect(parsed.assetStateAnchors[0]?.amount).toBe(120000);

    await importedDb.delete();
    importedDb.close();
  });
});
