import 'fake-indexeddb/auto';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { renderSettingsPanel } from '../../src/modules/settings/renderSettingsPanel';
import { AssetTrackerDb } from '../../src/storage/db';

describe('renderSettingsPanel', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb(`asset-tracker-settings-panel-${crypto.randomUUID()}`);
    await db.delete();
    await db.open();
  });

  afterEach(async () => {
    await db.delete();
    db.close();
    document.body.innerHTML = '';
  });

  it('supports dated exchange rates in the settings form and list', async () => {
    const book = await loadOrCreateLocalBook(db);
    await createCategory(db, {
      bookId: book.id,
      name: '美元账户',
      parentId: null,
      kind: 'asset',
      currency: 'USD'
    });
    const target = document.createElement('div');
    document.body.appendChild(target);

    await renderSettingsPanel({
      db,
      book,
      target
    });

    expect(target.querySelector('[data-role="exchange-rate-form"]')).not.toBeNull();
    expect(target.querySelector('input[name="effectiveFrom"]')).not.toBeNull();
    expect(target.textContent).toContain('生效日期');
  });
});
