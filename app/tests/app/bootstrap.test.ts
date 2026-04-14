import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import fixture from '../fixtures/legacy/assetTrackerData.sample.json';
import { bootstrapApp, closeBootstrapDb } from '../../src/app/bootstrap';
import * as bootstrapDomain from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { AssetTrackerDb } from '../../src/storage/db';

describe('bootstrapApp', () => {
  beforeEach(async () => {
    localStorage.removeItem('assetTrackerData');
    const db = new AssetTrackerDb();
    await db.delete();
    db.close();
  });

  afterEach(async () => {
    closeBootstrapDb();
    localStorage.removeItem('assetTrackerData');
    const db = new AssetTrackerDb();
    await db.delete();
    db.close();
  });

  it('clears the target and appends the app shell', async () => {
    const target = document.createElement('div');
    const staleNode = document.createElement('span');

    staleNode.textContent = 'stale';
    target.appendChild(staleNode);

    await bootstrapApp(target);

    const shell = target.firstElementChild as HTMLElement | null;

    expect(target.childElementCount).toBe(1);
    expect(shell?.dataset.appShell).toBe('true');
    expect(target.querySelector('[data-role="boot-status"]')?.textContent).toContain('Loaded Local Book');
    expect(target.querySelector('.sidebar')).not.toBeNull();
    expect(target.querySelector('.nav-link.active')?.getAttribute('data-section')).toBe('dashboard');
    expect(target.querySelector('#dashboard.content-section')).not.toBeNull();
    expect(target.querySelector('#modal')).not.toBeNull();
    expect(target.textContent).not.toContain('stale');
  });

  it('imports legacy localStorage data into an empty local book on first bootstrap', async () => {
    localStorage.setItem('assetTrackerData', JSON.stringify(fixture));

    const target = document.createElement('div');
    await bootstrapApp(target);

    const db = new AssetTrackerDb();
    await db.open();

    const book = await db.books.get('book_local');

    expect(book?.memo).toBe('legacy memo');
    expect(book?.baseCurrency).toBe('CNY');
    expect(await db.categories.count()).toBeGreaterThan(0);
    expect(await db.transactions.count()).toBe(1);
    expect(await db.transactionTemplates.count()).toBe(1);
    expect(await db.exchangeRates.count()).toBe(3);
    expect(await db.assetStateAnchors.count()).toBeGreaterThan(0);

    db.close();
  });

  it('normalizes older automation rules before rendering the automation panel', async () => {
    const db = new AssetTrackerDb();
    await db.open();
    await db.books.put({
      id: 'book_local',
      name: 'Local Book',
      type: 'private',
      baseCurrency: 'CNY',
      revision: 1,
      deletedAt: null,
      updatedBy: 'local-user',
      deviceId: 'device_local',
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z'
    } as never);
    await db.categories.put({
      id: 'cat_salary',
      bookId: 'book_local',
      parentId: null,
      name: '工资账户',
      kind: 'asset',
      currency: 'CNY',
      sortOrder: 0,
      isArchived: false,
      revision: 1,
      deletedAt: null,
      updatedBy: 'local-user',
      deviceId: 'device_local',
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z'
    } as never);
    await db.automationRules.put({
      id: 'rule_legacy_salary',
      bookId: 'book_local',
      categoryId: 'cat_salary',
      name: '旧版工资',
      amount: 100000,
      currency: 'CNY',
      direction: 'income',
      purpose: '工资',
      description: '旧版规则',
      frequency: 'monthly',
      interval: 1,
      startDate: '2026-01-01',
      endDate: null,
      lastGeneratedAt: null,
      isActive: true,
      revision: 1,
      deletedAt: null,
      updatedBy: 'local-user',
      deviceId: 'device_local',
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z'
    } as never);
    db.close();

    const target = document.createElement('div');

    await expect(bootstrapApp(target)).resolves.toBeUndefined();
    expect(target.querySelector('[data-role="boot-status"]')?.textContent).toContain('Loaded Local Book');
  });

  it('closes the db handle if bootstrap fails after opening the database', async () => {
    const target = document.createElement('div');
    const closeSpy = vi.spyOn(AssetTrackerDb.prototype, 'close');
    const loadSpy = vi
      .spyOn(bootstrapDomain, 'loadOrCreateLocalBook')
      .mockRejectedValueOnce(new Error('boot failed'));

    await expect(bootstrapApp(target)).rejects.toThrow('boot failed');
    expect(closeSpy).toHaveBeenCalled();

    loadSpy.mockRestore();
    closeSpy.mockRestore();
  });
});
