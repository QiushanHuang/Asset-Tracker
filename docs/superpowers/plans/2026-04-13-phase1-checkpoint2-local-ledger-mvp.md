# Phase 1 Local Ledger MVP Slice Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Deliver the first usable phase 1 ledger slice: a locally usable single-book ledger that can create hierarchical categories, record transactions, and refresh summary/list views from IndexedDB without direct DOM-driven data mutation.

**Architecture:** Keep the boot flow from checkpoint 1 and add a thin `renderApp` composition layer that mounts focused modules for summary, categories, and transactions into `#app-root`. This plan is a phase 1 sub-slice, not the whole next checkpoint: it establishes the manual ledger path first, while later slices will add drag-sort/edit/delete, templates, automation rules, import/export, and legacy auto-migration. Domain services own validation and repository writes, repositories continue enforcing `revision`/operation-log semantics, and UI modules emit intent through forms and re-render from repository-backed queries after each successful write.

**Tech Stack:** Vite, TypeScript, Dexie, Zod, Vitest, jsdom, npm

---

## File Structure

### Application Composition

- Create: `PROJECT_ROOT/app/src/app/renderApp.ts`
- Modify: `PROJECT_ROOT/app/src/app/bootstrap.ts`
- Modify: `PROJECT_ROOT/app/src/app/shell.ts`
- Modify: `PROJECT_ROOT/app/src/styles/base.css`

### Domain Services

- Create: `PROJECT_ROOT/app/src/domain/categories/createCategory.ts`
- Create: `PROJECT_ROOT/app/src/domain/categories/listCategoryTree.ts`
- Create: `PROJECT_ROOT/app/src/domain/transactions/createTransaction.ts`
- Create: `PROJECT_ROOT/app/src/domain/transactions/listTransactionsForBook.ts`
- Create: `PROJECT_ROOT/app/src/domain/dashboard/calculateBookSummary.ts`

### Storage Updates

- Modify: `PROJECT_ROOT/app/src/storage/repositories/categoryRepository.ts`
- Modify: `PROJECT_ROOT/app/src/storage/repositories/transactionRepository.ts`

### UI Modules

- Create: `PROJECT_ROOT/app/src/modules/dashboard/renderSummaryPanel.ts`
- Create: `PROJECT_ROOT/app/src/modules/categories/renderCategoryPanel.ts`
- Create: `PROJECT_ROOT/app/src/modules/transactions/renderTransactionPanel.ts`

### Tests

- Create: `PROJECT_ROOT/app/tests/app/renderApp.test.ts`
- Create: `PROJECT_ROOT/app/tests/domain/createCategory.test.ts`
- Create: `PROJECT_ROOT/app/tests/domain/createTransaction.test.ts`
- Create: `PROJECT_ROOT/app/tests/domain/calculateBookSummary.test.ts`
- Create: `PROJECT_ROOT/app/tests/checkpoint2.acceptance.test.ts`

## Task 1: Mount the Ledger Workspace After Boot

**Files:**
- Create: `PROJECT_ROOT/app/src/app/renderApp.ts`
- Modify: `PROJECT_ROOT/app/src/app/bootstrap.ts`
- Modify: `PROJECT_ROOT/app/src/app/shell.ts`
- Create: `PROJECT_ROOT/app/tests/app/renderApp.test.ts`

- [ ] **Step 1: Write the failing render integration test**

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AssetTrackerDb } from '../../src/storage/db';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { renderApp } from '../../src/app/renderApp';

describe('renderApp', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-render-app');
    await db.delete();
    await db.open();
  });

  it('mounts summary, categories, and transactions panels for the local book', async () => {
    const target = document.createElement('div');
    const book = await loadOrCreateLocalBook(db);

    await renderApp({
      db,
      book,
      target
    });

    expect(target.querySelector('[data-panel="summary"]')).not.toBeNull();
    expect(target.querySelector('[data-panel="categories"]')).not.toBeNull();
    expect(target.querySelector('[data-panel="transactions"]')).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd PROJECT_ROOT/app && npm test -- --run tests/app/renderApp.test.ts`
Expected: FAIL because `renderApp` and the panel markup do not exist yet.

- [ ] **Step 3: Implement the render composition**

```ts
// /app/src/app/renderApp.ts
import type { Book } from '../shared/types/entities';
import { AssetTrackerDb } from '../storage/db';
import { renderCategoryPanel } from '../modules/categories/renderCategoryPanel';
import { renderSummaryPanel } from '../modules/dashboard/renderSummaryPanel';
import { renderTransactionPanel } from '../modules/transactions/renderTransactionPanel';

export interface AppRenderContext {
  db: AssetTrackerDb;
  book: Book;
  target: HTMLElement;
}

export async function renderApp({ db, book, target }: AppRenderContext): Promise<void> {
  target.innerHTML = `
    <section class="workspace-grid">
      <div data-panel="summary"></div>
      <div data-panel="categories"></div>
      <div data-panel="transactions"></div>
    </section>
  `;

  const refresh = async (): Promise<void> => {
    await Promise.all([
      renderSummaryPanel({ db, book, target: target.querySelector('[data-panel="summary"]') as HTMLElement }),
      renderCategoryPanel({ db, book, target: target.querySelector('[data-panel="categories"]') as HTMLElement, onChange: refresh }),
      renderTransactionPanel({ db, book, target: target.querySelector('[data-panel="transactions"]') as HTMLElement, onChange: refresh })
    ]);
  };

  await refresh();
}
```

```ts
// /app/src/app/bootstrap.ts (inside bootstrapApp after book load)
const appRoot = shell.querySelector<HTMLElement>('#app-root');
if (!appRoot) {
  throw new Error('Missing #app-root mount node');
}

await renderApp({
  db,
  book,
  target: appRoot
});
```

- [ ] **Step 4: Run the render integration test**

Run: `cd PROJECT_ROOT/app && npm test -- --run tests/app/renderApp.test.ts tests/app/bootstrap.test.ts`
Expected: PASS with both tests green.

- [ ] **Step 5: Commit**

```bash
cd PROJECT_ROOT
git add app/src/app app/tests/app/renderApp.test.ts
git commit -m "feat: mount checkpoint2 ledger workspace"
```

## Task 2: Create and Display Hierarchical Category Trees

**Files:**
- Create: `PROJECT_ROOT/app/src/domain/categories/createCategory.ts`
- Create: `PROJECT_ROOT/app/src/domain/categories/listCategoryTree.ts`
- Modify: `PROJECT_ROOT/app/src/storage/repositories/categoryRepository.ts`
- Create: `PROJECT_ROOT/app/src/modules/categories/renderCategoryPanel.ts`
- Create: `PROJECT_ROOT/app/tests/domain/createCategory.test.ts`

- [ ] **Step 1: Write the failing category domain test**

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AssetTrackerDb } from '../../src/storage/db';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { listCategoryTree } from '../../src/domain/categories/listCategoryTree';

describe('createCategory', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-create-category');
    await db.delete();
    await db.open();
  });

  it('creates a root category and returns it in the tree query', async () => {
    const book = await loadOrCreateLocalBook(db);

    await createCategory(db, {
      bookId: book.id,
      name: '支付宝',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    const tree = await listCategoryTree(db, book.id);

    expect(tree).toEqual([
      expect.objectContaining({
        name: '支付宝',
        depth: 0,
        aggregateAmount: 0
      })
    ]);
  });
});
```

- [ ] **Step 2: Run the category test to verify it fails**

Run: `cd PROJECT_ROOT/app && npm test -- --run tests/domain/createCategory.test.ts`
Expected: FAIL because the category domain services do not exist.

- [ ] **Step 3: Implement repository queries and creation service**

```ts
// /app/src/storage/repositories/categoryRepository.ts
listByBook(bookId: string): Promise<Category[]> {
  return this.db.categories.where('bookId').equals(bookId).sortBy('sortOrder');
}
```

```ts
// /app/src/domain/categories/createCategory.ts
import { categorySchema } from '../../shared/validation/schemas';
import { AssetTrackerDb } from '../../storage/db';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';

export interface CreateCategoryInput {
  bookId: string;
  name: string;
  parentId: string | null;
  kind: 'asset' | 'debt' | 'group';
  currency: 'CNY' | 'SGD' | 'USD' | 'MYR';
}

export async function createCategory(db: AssetTrackerDb, input: CreateCategoryInput): Promise<void> {
  const repository = new CategoryRepository(db);
  const existing = await repository.listByBook(input.bookId);
  const sortOrder = existing.filter((item) => item.parentId === input.parentId).length;
  const now = new Date().toISOString();
  const category = categorySchema.parse({
    id: `cat_${crypto.randomUUID()}`,
    bookId: input.bookId,
    parentId: input.parentId,
    name: input.name.trim(),
    kind: input.kind,
    currency: input.currency,
    sortOrder,
    isArchived: false,
    revision: 1,
    deletedAt: null,
    updatedBy: 'local-user',
    deviceId: 'device_local',
    createdAt: now,
    updatedAt: now
  });

  await repository.put(category);
}
```

```ts
// /app/src/domain/categories/listCategoryTree.ts
export interface CategoryTreeItem {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  kind: 'asset' | 'debt' | 'group';
  currency: 'CNY' | 'SGD' | 'USD' | 'MYR';
  aggregateAmount: number;
}
```

- [ ] **Step 4: Implement the category panel**

```ts
// /app/src/modules/categories/renderCategoryPanel.ts
export async function renderCategoryPanel({ db, book, target, onChange }: CategoryPanelContext): Promise<void> {
  const categories = await listCategoryTree(db, book.id);

  target.innerHTML = `
    <section class="panel">
      <header class="panel__header">
        <h2>分类</h2>
      </header>
      <form data-role="category-form">
        <input name="name" placeholder="新分类名称" required />
        <select name="parentId">
          <option value="">顶层分类</option>
          ${categories.map((item) => `<option value="${item.id}">${'— '.repeat(item.depth)}${item.name}</option>`).join('')}
        </select>
        <select name="kind">
          <option value="asset">资产</option>
          <option value="debt">负债</option>
          <option value="group">分组</option>
        </select>
        <select name="currency">
          <option value="CNY">CNY</option>
          <option value="SGD">SGD</option>
          <option value="USD">USD</option>
          <option value="MYR">MYR</option>
        </select>
        <button type="submit">添加分类</button>
      </form>
      <ul data-role="category-list">
        ${categories.map((item) => `<li data-depth="${item.depth}">${item.name}</li>`).join('')}
      </ul>
    </section>
  `;

  target.querySelector<HTMLFormElement>('[data-role="category-form"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const formData = new FormData(form);
    await createCategory(db, {
      bookId: book.id,
      name: String(formData.get('name') ?? ''),
      parentId: String(formData.get('parentId') ?? '') || null,
      kind: String(formData.get('kind') ?? 'asset') as 'asset' | 'debt' | 'group',
      currency: String(formData.get('currency') ?? 'CNY') as 'CNY' | 'SGD' | 'USD' | 'MYR'
    });
    await onChange();
  });
}
```

- [ ] **Step 5: Run the category test**

Run: `cd PROJECT_ROOT/app && npm test -- --run tests/domain/createCategory.test.ts tests/app/renderApp.test.ts`
Expected: PASS with the tree query and render integration green.

- [ ] **Step 6: Commit**

```bash
cd PROJECT_ROOT
git add app/src/domain/categories app/src/modules/categories app/src/storage/repositories/categoryRepository.ts app/tests/domain/createCategory.test.ts
git commit -m "feat: add local category workspace"
```

## Task 3: Record Transactions and Refresh the Dashboard

**Files:**
- Create: `PROJECT_ROOT/app/src/domain/transactions/createTransaction.ts`
- Create: `PROJECT_ROOT/app/src/domain/transactions/listTransactionsForBook.ts`
- Create: `PROJECT_ROOT/app/src/domain/dashboard/calculateBookSummary.ts`
- Modify: `PROJECT_ROOT/app/src/storage/repositories/transactionRepository.ts`
- Create: `PROJECT_ROOT/app/src/modules/dashboard/renderSummaryPanel.ts`
- Create: `PROJECT_ROOT/app/src/modules/transactions/renderTransactionPanel.ts`
- Create: `PROJECT_ROOT/app/tests/domain/createTransaction.test.ts`
- Create: `PROJECT_ROOT/app/tests/domain/calculateBookSummary.test.ts`

- [ ] **Step 1: Write the failing transaction and summary tests**

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AssetTrackerDb } from '../../src/storage/db';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../../src/domain/categories/createCategory';
import { createTransaction } from '../../src/domain/transactions/createTransaction';
import { calculateBookSummary } from '../../src/domain/dashboard/calculateBookSummary';

describe('createTransaction', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-create-transaction');
    await db.delete();
    await db.open();
  });

  it('creates an expense transaction and updates the book summary', async () => {
    const book = await loadOrCreateLocalBook(db);
    await createCategory(db, {
      bookId: book.id,
      name: '支付宝',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });
    const [category] = await db.categories.toArray();

    await createTransaction(db, {
      bookId: book.id,
      categoryId: category.id,
      amount: 25.5,
      currency: 'CNY',
      direction: 'expense',
      purpose: '餐饮',
      description: '午饭',
      occurredAt: '2026-04-13T12:00:00.000Z'
    });

    const summary = await calculateBookSummary(db, book.id);

    expect(summary.netAmount).toBe(-2550);
    expect(summary.transactionCount).toBe(1);
  });
});
```

- [ ] **Step 2: Run the transaction tests to verify they fail**

Run: `cd PROJECT_ROOT/app && npm test -- --run tests/domain/createTransaction.test.ts tests/domain/calculateBookSummary.test.ts`
Expected: FAIL because the transaction services and summary logic do not exist.

- [ ] **Step 3: Implement transaction creation and summary services**

```ts
// /app/src/domain/transactions/createTransaction.ts
import { transactionSchema } from '../../shared/validation/schemas';
import type { MonetaryAmount } from '../../shared/types/entities';
import { AssetTrackerDb } from '../../storage/db';
import { TransactionRepository } from '../../storage/repositories/transactionRepository';

function toSignedMinorUnits(amount: number, direction: 'income' | 'expense' | 'transfer' | 'adjustment'): MonetaryAmount {
  const normalized = Math.round(amount * 100);
  const signed = direction === 'expense' ? normalized * -1 : normalized;
  return signed as MonetaryAmount;
}

export async function createTransaction(db: AssetTrackerDb, input: CreateTransactionInput): Promise<void> {
  const repository = new TransactionRepository(db);
  const existing = await repository.listByBook(input.bookId);
  const now = new Date().toISOString();
  const transaction = transactionSchema.parse({
    id: `txn_${crypto.randomUUID()}`,
    bookId: input.bookId,
    categoryId: input.categoryId,
    amount: input.direction === 'adjustment' ? input.amount : Math.abs(input.amount),
    currency: input.currency,
    direction: input.direction,
    purpose: input.purpose.trim(),
    description: input.description.trim(),
    occurredAt: input.occurredAt,
    revision: 1,
    deletedAt: null,
    updatedBy: 'local-user',
    deviceId: 'device_local',
    createdAt: now,
    updatedAt: now
  });

  const signedTransaction = {
    ...transaction,
    amount: toSignedMinorUnits(Number(transaction.amount) / 100, input.direction)
  };

  await repository.put(signedTransaction);
}
```

```ts
// /app/src/domain/dashboard/calculateBookSummary.ts
export interface BookSummary {
  netAmount: number;
  assetAmount: number;
  debtAmount: number;
  transactionCount: number;
}
```

- [ ] **Step 4: Implement the summary and transaction panels**

```ts
// /app/src/modules/dashboard/renderSummaryPanel.ts
const summary = await calculateBookSummary(db, book.id);
target.innerHTML = `
  <section class="panel" data-panel="summary">
    <header class="panel__header"><h2>总览</h2></header>
    <div class="metric-grid">
      <article><span>净资产</span><strong>${(summary.netAmount / 100).toFixed(2)}</strong></article>
      <article><span>资产</span><strong>${(summary.assetAmount / 100).toFixed(2)}</strong></article>
      <article><span>负债</span><strong>${(summary.debtAmount / 100).toFixed(2)}</strong></article>
      <article><span>账单数</span><strong>${summary.transactionCount}</strong></article>
    </div>
  </section>
`;
```

```ts
// /app/src/modules/transactions/renderTransactionPanel.ts
const categories = await listCategoryTree(db, book.id);
const transactionOptions = categories
  .filter((item) => item.kind !== 'group')
  .map((item) => `<option value="${item.id}">${'— '.repeat(item.depth)}${item.name}</option>`)
  .join('');
```

- [ ] **Step 5: Run the transaction and render tests**

Run: `cd PROJECT_ROOT/app && npm test -- --run tests/domain/createTransaction.test.ts tests/domain/calculateBookSummary.test.ts tests/app/renderApp.test.ts`
Expected: PASS with summary and transaction tests green.

- [ ] **Step 6: Commit**

```bash
cd PROJECT_ROOT
git add app/src/domain/dashboard app/src/domain/transactions app/src/modules/dashboard app/src/modules/transactions app/src/storage/repositories/transactionRepository.ts app/tests/domain/createTransaction.test.ts app/tests/domain/calculateBookSummary.test.ts
git commit -m "feat: add local transaction ledger flow"
```

## Task 4: Add Checkpoint 2 Acceptance and Styling Gates

**Files:**
- Modify: `PROJECT_ROOT/app/src/styles/base.css`
- Create: `PROJECT_ROOT/app/tests/checkpoint2.acceptance.test.ts`

- [ ] **Step 1: Write the failing checkpoint 2 acceptance test**

```ts
import 'fake-indexeddb/auto';
import { beforeEach, describe, expect, it } from 'vitest';
import { AssetTrackerDb } from '../src/storage/db';
import { loadOrCreateLocalBook } from '../src/domain/bootstrap/loadOrCreateLocalBook';
import { createCategory } from '../src/domain/categories/createCategory';
import { createTransaction } from '../src/domain/transactions/createTransaction';
import { renderApp } from '../src/app/renderApp';

describe('checkpoint 2 acceptance', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-checkpoint2');
    await db.delete();
    await db.open();
  });

  it('renders a usable local ledger after creating a category and transaction', async () => {
    const book = await loadOrCreateLocalBook(db);
    await createCategory(db, {
      bookId: book.id,
      name: '现金',
      parentId: null,
      kind: 'asset',
      currency: 'CNY'
    });

    const [category] = await db.categories.toArray();
    await createTransaction(db, {
      bookId: book.id,
      categoryId: category.id,
      amount: 100,
      currency: 'CNY',
      direction: 'income',
      purpose: '初始化',
      description: '启动资金',
      occurredAt: '2026-04-13T00:00:00.000Z'
    });

    const target = document.createElement('div');
    await renderApp({ db, book, target });

    expect(target.textContent).toContain('净资产');
    expect(target.textContent).toContain('现金');
    expect(target.textContent).toContain('启动资金');
  });
});
```

- [ ] **Step 2: Run the acceptance test to verify it fails**

Run: `cd PROJECT_ROOT/app && npm test -- --run tests/checkpoint2.acceptance.test.ts`
Expected: FAIL until the app renders the ledger workspace and domain flows correctly.

- [ ] **Step 3: Add the checkpoint 2 workspace styling**

```css
/* /app/src/styles/base.css */
:root {
  color-scheme: light;
  --surface: #fff9f1;
  --surface-strong: #f4ebdc;
  --ink: #1f1a14;
  --accent: #b85c38;
  --accent-strong: #8c3d20;
  --line: rgba(31, 26, 20, 0.12);
}

.workspace-grid {
  display: grid;
  gap: 16px;
  grid-template-columns: minmax(260px, 0.9fr) minmax(320px, 1.2fr);
}

.panel {
  border: 1px solid var(--line);
  border-radius: 20px;
  background: linear-gradient(180deg, rgba(255, 255, 255, 0.92), rgba(244, 235, 220, 0.95));
  padding: 20px;
}
```

- [ ] **Step 4: Run the full checkpoint 2 suite**

Run: `cd PROJECT_ROOT/app && npm test -- --run`
Expected: PASS with checkpoint 1 and checkpoint 2 tests all green.

- [ ] **Step 5: Build the app**

Run: `cd PROJECT_ROOT/app && npm run build`
Expected: PASS and produce an updated production bundle.

- [ ] **Step 6: Commit**

```bash
cd PROJECT_ROOT
git add app/src/styles/base.css app/tests/checkpoint2.acceptance.test.ts
git commit -m "test: add checkpoint2 local ledger acceptance"
```

## Spec Coverage Check

- 本地单用户账本继续沿用 checkpoint 1 的 boot flow: covered by Task 1.
- 分类树管理的最小可用链路（新增 + 展示 + 层级）: covered by Task 2.
- 账单录入、最近记录、基本汇总: covered by Task 3.
- 基本可用页面和稳定性验收: covered by Task 4.

## Self-Review Notes

- This plan is intentionally a phase 1 sub-slice. The remaining phase 1 requirements still need follow-on slices for tree editing/drag-sort, bill edit/delete, templates, automation rules, import/export, exchange-rate tooling, and legacy auto-migration.
- The plan keeps writes inside domain services and keeps the UI in read-refresh cycles to avoid rebuilding the old DOM mutation tangle.
