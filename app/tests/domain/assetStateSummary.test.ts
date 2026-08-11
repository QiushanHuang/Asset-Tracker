import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { calculateBookSummaryAt } from '../../src/domain/dashboard/calculateBookSummaryAt';
import { createAssetStateAnchor } from '../../src/domain/assetStates/createAssetStateAnchor';
import { listAssetStateAnchorsForBook } from '../../src/domain/assetStates/listAssetStateAnchorsForBook';
import { updateAssetStateAnchor } from '../../src/domain/assetStates/updateAssetStateAnchor';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { AssetTrackerDb } from '../../src/storage/db';

describe('asset state anchored summaries', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-asset-state-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
  });

  it('keeps current balance anchored when an earlier transaction is inserted before the asset state time', async () => {
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
      note: '月中盘点'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 50,
      currency: 'CNY',
      direction: 'income',
      purpose: '后续入账',
      description: '',
      occurredAt: '2026-04-12T08:00:00.000Z'
    });
    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 20,
      currency: 'CNY',
      direction: 'income',
      purpose: '更早入账',
      description: '',
      occurredAt: '2026-04-01T08:00:00.000Z'
    });

    const currentSummary = await calculateBookSummaryAt(db, book.id, '2026-04-13T00:00:00.000Z');
    const preAnchorSummary = await calculateBookSummaryAt(db, book.id, '2026-04-05T00:00:00.000Z');
    const anchorMomentSummary = await calculateBookSummaryAt(db, book.id, '2026-04-10T09:00:00.000Z');

    expect(currentSummary.assetAmount).toBe(105000);
    expect(anchorMomentSummary.assetAmount).toBe(100000);
    expect(preAnchorSummary.assetAmount).toBe(2000);
  });

  it('falls back to transaction-only summaries when no asset state exists', async () => {
    const book = await loadOrCreateLocalBook(db);
    const cash = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 88,
      currency: 'CNY',
      direction: 'income',
      purpose: '初始化',
      description: '',
      occurredAt: '2026-04-01T08:00:00.000Z'
    });

    const summary = await calculateBookSummaryAt(db, book.id, '2026-04-13T00:00:00.000Z');

    expect(summary.assetAmount).toBe(8800);
    expect(summary.netAmount).toBe(8800);
  });

  it('includes transactions that occur exactly at the anchor timestamp', async () => {
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
    await createTransaction(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 20,
      currency: 'CNY',
      direction: 'income',
      purpose: '同刻入账',
      description: '',
      occurredAt: '2026-04-10T09:00:00.000Z'
    });

    const summary = await calculateBookSummaryAt(db, book.id, '2026-04-10T09:00:00.000Z');

    expect(summary.assetAmount).toBe(102000);
  });

  it('treats positive debt anchor input as an outstanding liability in summaries', async () => {
    const book = await loadOrCreateLocalBook(db);
    const debt = await createCategory(db, {
      bookId: book.id,
      name: '信用卡',
      parentId: null,
      kind: 'debt',
      currency: 'CNY'
    });

    await createAssetStateAnchor(db, {
      bookId: book.id,
      categoryId: debt.id,
      amount: 300,
      currency: 'CNY',
      anchoredAt: '2026-04-10T09:00:00.000Z',
      note: '账单日负债'
    });

    const summary = await calculateBookSummaryAt(db, book.id, '2026-04-13T00:00:00.000Z');

    expect(summary.assetAmount).toBe(0);
    expect(summary.debtAmount).toBe(30000);
    expect(summary.netAmount).toBe(-30000);
  });

  it('collapses duplicate anchors when editing onto an existing timestamp', async () => {
    const book = await loadOrCreateLocalBook(db);
    const cash = await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    const morning = await createAssetStateAnchor(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 1000,
      currency: 'CNY',
      anchoredAt: '2026-04-10T09:00:00.000Z',
      note: '早盘'
    });
    await createAssetStateAnchor(db, {
      bookId: book.id,
      categoryId: cash.id,
      amount: 1200,
      currency: 'CNY',
      anchoredAt: '2026-04-10T12:00:00.000Z',
      note: '午盘'
    });

    await updateAssetStateAnchor(db, {
      bookId: book.id,
      anchorId: morning.id,
      categoryId: cash.id,
      amount: 1500,
      currency: 'CNY',
      anchoredAt: '2026-04-10T12:00:00.000Z',
      note: '合并更新'
    });

    const anchors = await listAssetStateAnchorsForBook(db, book.id);

    expect(anchors).toHaveLength(1);
    expect(anchors[0]?.anchoredAt).toBe('2026-04-10T12:00:00.000Z');
    expect(anchors[0]?.amount).toBe(150000);
    expect(anchors[0]?.note).toBe('合并更新');
  });
});
