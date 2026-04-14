import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createAssetStateAnchor } from '../../src/domain/assetStates/createAssetStateAnchor';
import { listAssetStateAnchorsForBook } from '../../src/domain/assetStates/listAssetStateAnchorsForBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { deleteCategory } from '../../src/domain/categories/deleteCategory';
import { listCategoryTree } from '../../src/domain/categories/listCategoryTree';
import { moveCategory } from '../../src/domain/categories/moveCategory';
import { updateCategory } from '../../src/domain/categories/updateCategory';
import { createAutomationRule } from '../../src/domain/automation/createAutomationRule';
import { listAutomationRulesForBook } from '../../src/domain/automation/listAutomationRulesForBook';
import { createTransactionTemplate } from '../../src/domain/templates/createTransactionTemplate';
import { listTransactionTemplatesForBook } from '../../src/domain/templates/listTransactionTemplatesForBook';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { listTransactionsForBook } from '../../src/domain/transactions/listTransactionsForBook';
import { AssetTrackerDb } from '../../src/storage/db';
import { CategoryRepository } from '../../src/storage/repositories/categoryRepository';
import { TransactionRepository } from '../../src/storage/repositories/transactionRepository';

describe('category lifecycle', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-category-lifecycle-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('updates a category and bumps the revision', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    const updated = await updateCategory(db, {
      bookId: book.id,
      categoryId: category.id,
      parentId: null,
      name: '备用金',
      kind: 'debt',
      currency: 'CNY'
    });

    expect(updated.name).toBe('备用金');
    expect(updated.kind).toBe('debt');
    expect(updated.revision).toBe(2);
  });

  it('rejects changing kind once transaction or anchor history exists', async () => {
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
      amount: 50,
      currency: 'CNY',
      direction: 'expense',
      purpose: '消费',
      description: '',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });
    await createAssetStateAnchor(db, {
      bookId: book.id,
      categoryId: category.id,
      amount: 200,
      currency: 'CNY',
      anchoredAt: '2026-04-14T00:00:00.000Z',
      note: '账单日'
    });

    await expect(
      updateCategory(db, {
        bookId: book.id,
        categoryId: category.id,
        parentId: null,
        name: '信用卡',
        kind: 'asset',
        currency: 'CNY'
      })
    ).rejects.toThrow('Cannot change category kind when balance history already exists');
  });

  it('soft deletes a category subtree and its transactions', async () => {
    const book = await loadOrCreateLocalBook(db);
    const parent = await createCategory(db, {
      bookId: book.id,
      name: '钱包',
      parentId: null,
      kind: 'group',
      currency: 'CNY'
    });
    const child = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: parent.id,
      kind: 'asset',
      currency: 'CNY'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: child.id,
      amount: 88,
      currency: 'CNY',
      direction: 'income',
      purpose: '初始化',
      description: '启动资金',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });

    await deleteCategory(db, {
      bookId: book.id,
      categoryId: parent.id
    });

    const categories = await new CategoryRepository(db).listByBook(book.id);
    const transactions = await new TransactionRepository(db).listByBook(book.id);

    expect(categories.find((item) => item.id === parent.id)?.deletedAt).not.toBeNull();
    expect(categories.find((item) => item.id === child.id)?.deletedAt).not.toBeNull();
    expect(transactions[0]?.deletedAt).not.toBeNull();
    expect(await listCategoryTree(db, book.id)).toEqual([]);
    expect(await listTransactionsForBook(db, book.id)).toEqual([]);
  });

  it('retires linked templates and automation rules when deleting a category', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '投资',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    await createTransactionTemplate(db, {
      bookId: book.id,
      name: '定投模板',
      categoryId: category.id,
      amount: 100,
      currency: 'CNY',
      direction: 'expense',
      purpose: '定投',
      description: '每周买入'
    });
    await createAutomationRule(db, {
      bookId: book.id,
      name: '定投规则',
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

    await deleteCategory(db, {
      bookId: book.id,
      categoryId: category.id
    });

    expect(await listTransactionTemplatesForBook(db, book.id)).toEqual([]);
    expect(await listAutomationRulesForBook(db, book.id)).toEqual([]);
  });

  it('retires linked asset-state anchors when deleting a category', async () => {
    const book = await loadOrCreateLocalBook(db);
    const category = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    await createAssetStateAnchor(db, {
      bookId: book.id,
      categoryId: category.id,
      amount: 500,
      currency: 'CNY',
      anchoredAt: '2026-04-13T00:00:00.000Z',
      note: '收盘盘点'
    });

    await deleteCategory(db, {
      bookId: book.id,
      categoryId: category.id
    });

    expect(await listAssetStateAnchorsForBook(db, book.id)).toEqual([]);
  });

  it('moves a category after a sibling and rewrites sort order', async () => {
    const book = await loadOrCreateLocalBook(db);
    const cash = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const bank = await createCategory(db, {
      bookId: book.id,
      name: '银行卡',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const wallet = await createCategory(db, {
      bookId: book.id,
      name: '钱包',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    await moveCategory(db, {
      bookId: book.id,
      categoryId: cash.id,
      targetParentId: null,
      targetIndex: 2
    });

    const tree = await listCategoryTree(db, book.id);

    expect(tree.map((item) => item.name)).toEqual(['银行卡', '钱包', '现金']);
    expect(tree.map((item) => item.sortOrder)).toEqual([0, 1, 2]);
  });

  it('reparents a category during edit updates', async () => {
    const book = await loadOrCreateLocalBook(db);
    const group = await createCategory(db, {
      bookId: book.id,
      name: '资产组',
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

    await updateCategory(db, {
      bookId: book.id,
      categoryId: category.id,
      parentId: group.id,
      name: '现金',
      kind: 'asset',
      currency: 'CNY'
    });

    const tree = await listCategoryTree(db, book.id);
    const updated = tree.find((item) => item.id === category.id);

    expect(updated?.parentId).toBe(group.id);
    expect(updated?.depth).toBe(1);
  });

  it('aggregates descendant transaction totals onto parent categories', async () => {
    const book = await loadOrCreateLocalBook(db);
    const parent = await createCategory(db, {
      bookId: book.id,
      name: '家庭资产',
      parentId: null,
      kind: 'group',
      currency: 'CNY'
    });
    const child = await createCategory(db, {
      bookId: book.id,
      name: '活期',
      parentId: parent.id,
      kind: 'asset',
      currency: 'CNY'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: child.id,
      amount: 123.45,
      currency: 'CNY',
      direction: 'income',
      purpose: '入账',
      description: '',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });

    const tree = await listCategoryTree(db, book.id);
    const parentNode = tree.find((item) => item.id === parent.id);
    const childNode = tree.find((item) => item.id === child.id);

    expect(childNode?.aggregateAmount).toBe(12345);
    expect(parentNode?.aggregateAmount).toBe(12345);
  });

  it('rejects creating a child category under a parent with a different currency', async () => {
    const book = await loadOrCreateLocalBook(db);
    const parent = await createCategory(db, {
      bookId: book.id,
      name: '人民币资产',
      parentId: null,
      kind: 'group',
      currency: 'CNY'
    });

    await expect(
      createCategory(db, {
        bookId: book.id,
        name: '美元账户',
        parentId: parent.id,
        kind: 'asset',
        currency: 'USD'
      })
    ).rejects.toThrow('Child category currency must match parent category currency');
  });

  it('rejects moving a category into a parent with a different currency', async () => {
    const book = await loadOrCreateLocalBook(db);
    const cnyParent = await createCategory(db, {
      bookId: book.id,
      name: '人民币资产',
      parentId: null,
      kind: 'group',
      currency: 'CNY'
    });
    const usdCategory = await createCategory(db, {
      bookId: book.id,
      name: '美元账户',
      parentId: null,
      kind: 'asset',
      currency: 'USD'
    });

    await expect(
      moveCategory(db, {
        bookId: book.id,
        categoryId: usdCategory.id,
        targetParentId: cnyParent.id,
        targetIndex: 0
      })
    ).rejects.toThrow('Category currency must match target parent currency');
  });
});
