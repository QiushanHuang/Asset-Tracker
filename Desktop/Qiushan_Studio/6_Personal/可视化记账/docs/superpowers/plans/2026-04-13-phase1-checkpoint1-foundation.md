# Phase 1 Checkpoint 1 Foundation Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Build the new local-only bookkeeping foundation: isolated `Vite + TypeScript` app shell, IndexedDB persistence with revision/operation-log support, deterministic legacy migration, and a minimal boot flow that can load a migrated local book safely.

**Architecture:** Keep the old app read-only and build the new implementation in the repo's `app/` workspace so legacy behavior stays available until cutover. Use `Dexie` to wrap IndexedDB, `Zod` to validate legacy payloads and migration manifests, and a small application shell that loads the single local book through repositories and services instead of direct browser storage access.

**Tech Stack:** Vite, TypeScript, Dexie, Zod, Vitest, jsdom, npm

---

## File Structure

### Legacy Inputs

- Read-only reference: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/记账/index.html`
- Read-only reference: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/记账/script.js`
- Read-only reference: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/记账/styles.css`
- Ignore for migration logic: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/index.html`
- Ignore for migration logic: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/script.js`
- Ignore for migration logic: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/styles.css`

### New App Workspace

- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/package.json`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tsconfig.json`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tsconfig.node.json`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tsconfig.test.json`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/vite.config.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/vitest.config.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/index.html`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/main.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/app/bootstrap.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/app/shell.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/app/router.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/styles/base.css`

### Shared Domain and Validation

- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/shared/types/entities.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/shared/types/metadata.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/shared/validation/schemas.ts`

### Storage Layer

- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/db.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/schema.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/repositories/bookRepository.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/repositories/categoryRepository.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/repositories/transactionRepository.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/repositories/operationRepository.ts`

### Migration Layer

- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/migrations/types.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/migrations/legacyDeterministicId.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/migrations/legacyCategoryPath.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/migrations/legacyMigrationManifest.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/migrations/legacySnapshot.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/migrations/migrateLegacyAssetTracker.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/domain/bootstrap/loadOrCreateLocalBook.ts`

### Tests and Fixtures

- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/fixtures/legacy/assetTrackerData.sample.json`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/app/bootstrap.test.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/shared/schemas.test.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/storage/dbSchema.test.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/storage/legacyMigration.test.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/storage/revisionConflict.test.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/domain/loadOrCreateLocalBook.test.ts`

### Notes

- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/legacy/README.md`

## Task 1: Establish the New Workspace and Freeze Legacy Scope

**Files:**
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/legacy/README.md`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/package.json`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tsconfig.json`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tsconfig.node.json`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tsconfig.test.json`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/vite.config.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/vitest.config.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/index.html`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/main.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/app/bootstrap.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/app/shell.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/styles/base.css`
- Test: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/app/bootstrap.test.ts`

- [ ] **Step 1: Write the failing shell smoke test**

```ts
import { describe, expect, it } from 'vitest';
import { buildShell } from '../../src/app/shell';

describe('buildShell', () => {
  it('renders the app frame with a loading banner', () => {
    const element = buildShell();

    expect(element.dataset.appShell).toBe('true');
    expect(element.querySelector('[data-role="boot-status"]')?.textContent).toContain('Loading local book');
  });
});
```

- [ ] **Step 2: Run the test to verify it fails**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm test -- --run tests/app/bootstrap.test.ts`
Expected: FAIL because the `app` workspace and `buildShell` export do not exist yet.

- [ ] **Step 3: Scaffold the Vite workspace and shell**

```json
{
  "name": "asset-tracker-foundation",
  "private": true,
  "version": "0.1.0",
  "type": "module",
  "scripts": {
    "dev": "vite",
    "build": "tsc -b && vite build",
    "test": "vitest run",
    "test:watch": "vitest"
  },
  "dependencies": {
    "dexie": "^4.0.8",
    "zod": "^3.24.1"
  },
  "devDependencies": {
    "@types/node": "^22.10.2",
    "jsdom": "^25.0.1",
    "typescript": "^5.7.2",
    "vite": "^6.0.5",
    "vitest": "^2.1.8"
  }
}
```

```json
// /app/tsconfig.json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM"]
  },
  "include": ["src"]
}
```

```json
// /app/tsconfig.node.json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "noEmit": true,
    "lib": ["ES2022"],
    "types": ["node"]
  },
  "include": ["vite.config.ts", "vitest.config.ts"]
}
```

```json
// /app/tsconfig.test.json
{
  "compilerOptions": {
    "target": "ES2022",
    "useDefineForClassFields": true,
    "module": "ESNext",
    "moduleResolution": "Bundler",
    "strict": true,
    "resolveJsonModule": true,
    "isolatedModules": true,
    "esModuleInterop": true,
    "noEmit": true,
    "lib": ["ES2022", "DOM"],
    "types": ["vitest/globals"]
  },
  "include": ["tests/**/*.test.ts"]
}
```

```ts
// /app/vite.config.ts
import { defineConfig } from 'vite';

export default defineConfig({
  server: {
    host: '127.0.0.1',
    port: 5173
  }
});
```

```ts
// /app/vitest.config.ts
import { defineConfig } from 'vitest/config';

export default defineConfig({
  test: {
    environment: 'jsdom',
    include: ['tests/**/*.test.ts']
  }
});
```

```html
<!-- /app/index.html -->
<!doctype html>
<html lang="zh-CN">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <title>Asset Tracker Foundation</title>
  </head>
  <body>
    <div id="app"></div>
    <script type="module" src="/src/main.ts"></script>
  </body>
</html>
```

```ts
// /app/src/app/shell.ts
export function buildShell(): HTMLDivElement {
  const root = document.createElement('div');
  root.dataset.appShell = 'true';
  root.innerHTML = `
    <div class="app-shell">
      <header class="app-shell__header">Asset Tracker Foundation</header>
      <main class="app-shell__main">
        <p data-role="boot-status">Loading local book...</p>
        <div id="app-root"></div>
      </main>
    </div>
  `;
  return root;
}
```

```ts
// /app/src/app/bootstrap.ts
import { buildShell } from './shell';

export function bootstrapApp(target: HTMLElement): void {
  target.innerHTML = '';
  target.appendChild(buildShell());
}
```

```ts
// /app/src/app/router.ts
export type AppRoute = 'dashboard';

export function getInitialRoute(): AppRoute {
  return 'dashboard';
}
```

```ts
// /app/src/main.ts
import { bootstrapApp } from './app/bootstrap';
import './styles/base.css';

const target = document.getElementById('app');

if (!target) {
  throw new Error('Missing #app mount node');
}

bootstrapApp(target);
```

```css
/* /app/src/styles/base.css */
:root {
  color-scheme: light;
  font-family: "SF Pro Text", "PingFang SC", sans-serif;
  background: #f5f7fb;
  color: #152033;
}

body {
  margin: 0;
}

.app-shell {
  min-height: 100vh;
  display: grid;
  grid-template-rows: 64px 1fr;
}

.app-shell__header {
  display: flex;
  align-items: center;
  padding: 0 24px;
  border-bottom: 1px solid #d9e2f2;
  background: #ffffff;
  font-weight: 600;
}

.app-shell__main {
  padding: 24px;
}
```

```md
# Legacy Source of Truth

- Canonical legacy implementation: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/记账`
- Root-level `index.html`, `script.js`, `styles.css`, and `README.md` are treated as older duplicates and must not be used for migration rules.
- The new app lives in `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app`.
- Do not edit legacy files during checkpoint 1.
```

- [ ] **Step 4: Install dependencies and run the smoke test**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm install && npm test -- --run tests/app/bootstrap.test.ts`
Expected: PASS with `1 passed`.

- [ ] **Step 5: Verify the app builds**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm run build`
Expected: PASS and emit a `dist/` bundle.

- [ ] **Step 6: Commit**

```bash
cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账
git add legacy/README.md app
git commit -m "feat: scaffold foundation app workspace"
```

## Task 2: Define Persistent Entity Metadata and Validation Schemas

**Files:**
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/shared/types/metadata.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/shared/types/entities.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/shared/validation/schemas.ts`
- Test: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/shared/schemas.test.ts`

- [ ] **Step 1: Write the failing schema tests**

```ts
import { describe, expect, it } from 'vitest';
import { categorySchema, transactionSchema } from '../../src/shared/validation/schemas';

describe('entity schemas', () => {
  it('accepts a category with revision metadata', () => {
    const category = categorySchema.parse({
      id: 'cat_001',
      bookId: 'book_local',
      parentId: null,
      name: '银行卡',
      kind: 'group',
      currency: 'CNY',
      sortOrder: 0,
      isArchived: false,
      revision: 1,
      deletedAt: null,
      updatedBy: 'local-user',
      deviceId: 'device_local',
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z'
    });

    expect(category.name).toBe('银行卡');
  });

  it('rejects a transaction without occurredAt', () => {
    expect(() =>
      transactionSchema.parse({
        id: 'txn_001',
        bookId: 'book_local',
        categoryId: 'cat_001',
        amount: 20,
        currency: 'CNY',
        direction: 'expense',
        purpose: '餐饮',
        description: '午饭'
      })
    ).toThrow();
  });
});
```

- [ ] **Step 2: Run the schema tests to verify they fail**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm test -- --run tests/shared/schemas.test.ts`
Expected: FAIL because the schema module does not exist.

- [ ] **Step 3: Implement metadata types and schemas**

```ts
// /app/src/shared/types/metadata.ts
export interface EntityMetadata {
  revision: number;
  deletedAt: string | null;
  updatedBy: string;
  deviceId: string;
  createdAt: string;
  updatedAt: string;
}
```

```ts
// /app/src/shared/types/entities.ts
import type { EntityMetadata } from './metadata';

export interface Book extends EntityMetadata {
  id: string;
  name: string;
  type: 'private';
  baseCurrency: 'CNY' | 'SGD' | 'USD' | 'MYR';
}

export interface Category extends EntityMetadata {
  id: string;
  bookId: string;
  parentId: string | null;
  name: string;
  kind: 'asset' | 'debt' | 'group';
  currency: 'CNY' | 'SGD' | 'USD' | 'MYR';
  sortOrder: number;
  isArchived: boolean;
}

export interface Transaction extends EntityMetadata {
  id: string;
  bookId: string;
  categoryId: string;
  // Stored in minor units after schema normalization, for example CNY 20.50 -> 2050.
  amount: number;
  currency: 'CNY' | 'SGD' | 'USD' | 'MYR';
  direction: 'income' | 'expense' | 'transfer' | 'adjustment';
  purpose: string;
  description: string;
  occurredAt: string;
}
```

```ts
// /app/src/shared/validation/schemas.ts
import { z } from 'zod';

const AMOUNT_PRECISION = 2;
const MINOR_UNIT_SCALE = 10 ** AMOUNT_PRECISION;

const metadataSchema = z.object({
  revision: z.number().int().nonnegative(),
  deletedAt: z.string().datetime().nullable(),
  updatedBy: z.string().min(1),
  deviceId: z.string().min(1),
  createdAt: z.string().datetime(),
  updatedAt: z.string().datetime()
}).strict();

const currencySchema = z.enum(['CNY', 'SGD', 'USD', 'MYR']);
const amountSchema = z
  .number()
  .finite()
  .refine((value) => {
    const normalized = Number(value.toFixed(AMOUNT_PRECISION));
    return Math.abs(value - normalized) < Number.EPSILON;
  }, `Amount must use at most ${AMOUNT_PRECISION} decimal places`)
  .transform((value) => Math.round(value * MINOR_UNIT_SCALE));

export const categorySchema = metadataSchema.extend({
  id: z.string().min(1),
  bookId: z.string().min(1),
  parentId: z.string().min(1).nullable(),
  name: z.string().min(1),
  kind: z.enum(['asset', 'debt', 'group']),
  currency: currencySchema,
  sortOrder: z.number().int(),
  isArchived: z.boolean()
}).strict();

export const transactionSchema = metadataSchema.extend({
  id: z.string().min(1),
  bookId: z.string().min(1),
  categoryId: z.string().min(1),
  amount: amountSchema,
  currency: currencySchema,
  direction: z.enum(['income', 'expense', 'transfer', 'adjustment']),
  purpose: z.string().min(1),
  description: z.string(),
  occurredAt: z.string().datetime()
}).strict();
```

- [ ] **Step 4: Run the schema tests**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm test -- --run tests/shared/schemas.test.ts`
Expected: PASS with `2 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账
git add app/src/shared app/tests/shared
git commit -m "feat: add core entity schemas"
```

## Task 3: Implement IndexedDB Schema, Repositories, and Revision Protection

**Files:**
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/schema.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/db.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/repositories/bookRepository.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/repositories/categoryRepository.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/repositories/transactionRepository.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/repositories/operationRepository.ts`
- Test: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/storage/dbSchema.test.ts`
- Test: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/storage/revisionConflict.test.ts`

- [ ] **Step 1: Write the failing database tests**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { AssetTrackerDb } from '../../src/storage/db';

describe('AssetTrackerDb', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-test');
    await db.delete();
    await db.open();
  });

  it('creates stores for books, categories, transactions, and operations', () => {
    expect(db.tables.map((table) => table.name)).toEqual([
      'books',
      'categories',
      'transactions',
      'operations'
    ]);
  });
});
```

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { AssetTrackerDb } from '../../src/storage/db';
import { CategoryRepository } from '../../src/storage/repositories/categoryRepository';

describe('CategoryRepository', () => {
  let repository: CategoryRepository;

  beforeEach(async () => {
    const db = new AssetTrackerDb('asset-tracker-db-revision-test');
    await db.delete();
    await db.open();
    repository = new CategoryRepository(db);
  });

  it('rejects stale revisions', async () => {
    await repository.put({
      id: 'cat_001',
      bookId: 'book_local',
      parentId: null,
      name: '银行卡',
      kind: 'group',
      currency: 'CNY',
      sortOrder: 0,
      isArchived: false,
      revision: 1,
      deletedAt: null,
      updatedBy: 'local-user',
      deviceId: 'device_local',
      createdAt: '2026-04-13T00:00:00.000Z',
      updatedAt: '2026-04-13T00:00:00.000Z'
    });

    await expect(
      repository.put({
        id: 'cat_001',
        bookId: 'book_local',
        parentId: null,
        name: '银行卡-旧写入',
        kind: 'group',
        currency: 'CNY',
        sortOrder: 0,
        isArchived: false,
        revision: 1,
        deletedAt: null,
        updatedBy: 'local-user',
        deviceId: 'device_local',
        createdAt: '2026-04-13T00:00:00.000Z',
        updatedAt: '2026-04-13T00:00:01.000Z'
      })
    ).rejects.toThrow('Revision conflict');
  });
});
```

- [ ] **Step 2: Run the database tests to verify they fail**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm test -- --run tests/storage/dbSchema.test.ts tests/storage/revisionConflict.test.ts`
Expected: FAIL because the database and repositories do not exist yet.

- [ ] **Step 3: Implement the Dexie schema and repositories**

```ts
// /app/src/storage/schema.ts
export const DB_NAME = 'asset-tracker-db';
export const DB_VERSION = 1;

export const storeDefinitions = {
  books: '&id, updatedAt, deletedAt',
  categories: '&id, bookId, parentId, sortOrder, updatedAt, deletedAt',
  transactions: '&id, bookId, categoryId, occurredAt, updatedAt, deletedAt',
  operations: '&id, bookId, entityType, entityId, createdAt'
} as const;
```

```ts
// /app/src/storage/db.ts
import Dexie, { type Table } from 'dexie';
import type { Book, Category, Transaction } from '../shared/types/entities';

export interface OperationLogEntry {
  id: string;
  bookId: string;
  entityType: 'book' | 'category' | 'transaction';
  entityId: string;
  operationType: 'put' | 'delete';
  payload: string;
  deviceId: string;
  createdAt: string;
}

export class AssetTrackerDb extends Dexie {
  books!: Table<Book, string>;
  categories!: Table<Category, string>;
  transactions!: Table<Transaction, string>;
  operations!: Table<OperationLogEntry, string>;

  constructor(name = 'asset-tracker-db') {
    super(name);
    this.version(1).stores({
      books: '&id, updatedAt, deletedAt',
      categories: '&id, bookId, parentId, sortOrder, updatedAt, deletedAt',
      transactions: '&id, bookId, categoryId, occurredAt, updatedAt, deletedAt',
      operations: '&id, bookId, entityType, entityId, createdAt'
    });
  }
}
```

```ts
// /app/src/storage/repositories/categoryRepository.ts
import type { Category } from '../../shared/types/entities';
import { AssetTrackerDb } from '../db';

export class CategoryRepository {
  constructor(private readonly db: AssetTrackerDb) {}

  async put(category: Category): Promise<void> {
    await this.db.transaction('rw', this.db.categories, this.db.operations, async () => {
      const existing = await this.db.categories.get(category.id);

      if (existing && category.revision <= existing.revision) {
        throw new Error('Revision conflict');
      }

      await this.db.categories.put(category);
      await this.db.operations.put({
        id: `op_${category.id}_${category.revision}`,
        bookId: category.bookId,
        entityType: 'category',
        entityId: category.id,
        operationType: 'put',
        payload: JSON.stringify(category),
        deviceId: category.deviceId,
        createdAt: category.updatedAt
      });
    });
  }
}
```

```ts
// /app/src/storage/repositories/bookRepository.ts
import type { Book } from '../../shared/types/entities';
import { AssetTrackerDb } from '../db';

export class BookRepository {
  constructor(private readonly db: AssetTrackerDb) {}

  getById(id: string): Promise<Book | undefined> {
    return this.db.books.get(id);
  }

  async put(book: Book): Promise<string> {
    await this.db.transaction('rw', this.db.books, this.db.operations, async () => {
      const existing = await this.db.books.get(book.id);

      if (existing && book.revision <= existing.revision) {
        throw new Error('Revision conflict');
      }

      await this.db.books.put(book);
      await this.db.operations.put({
        id: `op_${book.id}_${book.revision}`,
        bookId: book.id,
        entityType: 'book',
        entityId: book.id,
        operationType: 'put',
        payload: JSON.stringify(book),
        deviceId: book.deviceId,
        createdAt: book.updatedAt
      });
    });

    return book.id;
  }
}
```

```ts
// /app/src/storage/repositories/transactionRepository.ts
import type { Transaction } from '../../shared/types/entities';
import { AssetTrackerDb } from '../db';

export class TransactionRepository {
  constructor(private readonly db: AssetTrackerDb) {}

  listByBook(bookId: string): Promise<Transaction[]> {
    return this.db.transactions.where('bookId').equals(bookId).sortBy('occurredAt');
  }

  async put(transaction: Transaction): Promise<void> {
    await this.db.transaction('rw', this.db.transactions, this.db.operations, async () => {
      const existing = await this.db.transactions.get(transaction.id);

      if (existing && transaction.revision <= existing.revision) {
        throw new Error('Revision conflict');
      }

      await this.db.transactions.put(transaction);
      await this.db.operations.put({
        id: `op_${transaction.id}_${transaction.revision}`,
        bookId: transaction.bookId,
        entityType: 'transaction',
        entityId: transaction.id,
        operationType: 'put',
        payload: JSON.stringify(transaction),
        deviceId: transaction.deviceId,
        createdAt: transaction.updatedAt
      });
    });
  }
}
```

```ts
// /app/src/storage/repositories/operationRepository.ts
import type { OperationLogEntry } from '../db';
import { AssetTrackerDb } from '../db';

export class OperationRepository {
  constructor(private readonly db: AssetTrackerDb) {}

  listByBook(bookId: string): Promise<OperationLogEntry[]> {
    return this.db.operations.where('bookId').equals(bookId).sortBy('createdAt');
  }
}
```

- [ ] **Step 4: Run the database tests**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm test -- --run tests/storage/dbSchema.test.ts tests/storage/revisionConflict.test.ts`
Expected: PASS with `2 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账
git add app/src/storage app/tests/storage
git commit -m "feat: add indexeddb foundation with revision protection"
```

## Task 4: Implement Deterministic Legacy Migration and Dry-Run Reporting

**Files:**
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/fixtures/legacy/assetTrackerData.sample.json`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/migrations/types.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/migrations/legacyDeterministicId.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/migrations/legacyCategoryPath.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/migrations/legacyMigrationManifest.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/migrations/legacySnapshot.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/storage/migrations/migrateLegacyAssetTracker.ts`
- Test: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/storage/legacyMigration.test.ts`

- [ ] **Step 1: Write the failing migration tests**

```ts
import { describe, expect, it } from 'vitest';
import fixture from '../fixtures/legacy/assetTrackerData.sample.json';
import { buildLegacyMigrationManifest } from '../../src/storage/migrations/legacyMigrationManifest';

describe('buildLegacyMigrationManifest', () => {
  it('resolves duplicate category names by full path', () => {
    const manifest = buildLegacyMigrationManifest(fixture as never);

    expect(manifest.categoryPathToId['银行卡/中国/ICBC']).not.toBe(manifest.categoryPathToId['银行卡/新加坡/ICBC']);
    expect(manifest.categoryPathToId['支付宝/钱包']).toBeDefined();
  });

  it('creates opening adjustments from legacy balances', () => {
    const manifest = buildLegacyMigrationManifest(fixture as never);

    expect(manifest.openingAdjustments.length).toBeGreaterThan(0);
    expect(manifest.report.totalCategories).toBeGreaterThan(0);
    expect(manifest.report.totalTransactions).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the migration test to verify it fails**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm test -- --run tests/storage/legacyMigration.test.ts`
Expected: FAIL because the fixture and migration helpers do not exist.

- [ ] **Step 3: Add the legacy fixture and migration helpers**

```json
{
  "categories": {
    "银行卡": {
      "id": "bank",
      "name": "银行卡",
      "children": {
        "中国": {
          "id": "bank-china",
          "name": "中国",
          "children": {
            "ICBC": { "id": "bank-china-icbc", "name": "ICBC", "balance": 1200, "currency": "CNY", "isDebt": false }
          }
        },
        "新加坡": {
          "id": "bank-singapore",
          "name": "新加坡",
          "children": {
            "ICBC": { "id": "bank-singapore-icbc", "name": "ICBC", "balance": 300, "currency": "SGD", "isDebt": false }
          }
        }
      }
    },
    "支付宝": {
      "id": "alipay",
      "name": "支付宝",
      "children": {
        "钱包": { "id": "alipay-wallet", "name": "钱包", "balance": 400, "currency": "CNY", "isDebt": false }
      }
    }
  },
  "transactions": [
    {
      "id": "txn-1",
      "date": "2026-04-01",
      "category": "银行卡",
      "subcategory": "ICBC",
      "amount": -20,
      "currency": "CNY",
      "purpose": "餐饮美食",
      "description": "午饭"
    }
  ],
  "initialAssets": {
    "银行卡/中国/ICBC": 1200
  },
  "settings": {
    "baseCurrency": "CNY",
    "exchangeRates": {
      "CNY": 1,
      "SGD": 5.2,
      "USD": 7.2,
      "MYR": 1.6
    }
  }
}
```

```ts
// /app/src/storage/migrations/legacyCategoryPath.ts
export function buildCategoryPath(parentPath: string | null, name: string): string {
  const encodedSegment = encodeURIComponent(name);
  return parentPath ? `${parentPath}/${encodedSegment}` : encodedSegment;
}
```

```ts
// /app/src/storage/migrations/types.ts
export interface LegacyTransactionInput {
  id: string;
  date: string;
  category: string;
  subcategory: string;
  amount: number;
  currency: 'CNY' | 'SGD' | 'USD' | 'MYR';
  purpose: string;
  description: string;
}

export interface LegacyMigrationReport {
  totalCategories: number;
  totalTransactions: number;
  totalOpeningAdjustments: number;
}
```

```ts
// /app/src/storage/migrations/legacyDeterministicId.ts
export function deterministicId(prefix: string, path: string): string {
  const normalized = encodeURIComponent(path);
  return `${prefix}_${normalized}`;
}
```

```ts
// /app/src/storage/migrations/legacyMigrationManifest.ts
import { buildCategoryPath } from './legacyCategoryPath';
import { deterministicId } from './legacyDeterministicId';

export function buildLegacyMigrationManifest(input: any) {
  const categoryPathToId: Record<string, string> = {};
  const openingAdjustments: Array<{ categoryPath: string; amount: number }> = [];

  function walk(node: any, parentPath: string | null): void {
    const path = buildCategoryPath(parentPath, node.name);
    categoryPathToId[path] = deterministicId('cat', path);

    if (typeof node.balance === 'number' && !node.children) {
      openingAdjustments.push({ categoryPath: path, amount: node.balance });
    }

    if (node.children) {
      Object.values(node.children).forEach((child) => walk(child, path));
    }
  }

  Object.values(input.categories).forEach((category: any) => walk(category, null));

  return {
    categoryPathToId,
    openingAdjustments,
    report: {
      totalCategories: Object.keys(categoryPathToId).length,
      totalTransactions: input.transactions.length,
      totalOpeningAdjustments: openingAdjustments.length
    }
  };
}
```

```ts
// /app/src/storage/migrations/legacySnapshot.ts
export function buildLegacyRawBackup(input: unknown): string {
  return JSON.stringify(input, null, 2);
}
```

```ts
// /app/src/storage/migrations/migrateLegacyAssetTracker.ts
import { AssetTrackerDb } from '../db';
import { buildLegacyMigrationManifest } from './legacyMigrationManifest';
import { buildLegacyRawBackup } from './legacySnapshot';

export async function migrateLegacyAssetTracker(db: AssetTrackerDb, input: unknown): Promise<void> {
  const backup = buildLegacyRawBackup(input);
  const manifest = buildLegacyMigrationManifest(input as never);

  await db.transaction('rw', db.operations, async () => {
    await db.operations.put({
      id: 'op_legacy_backup_1',
      bookId: 'book_local',
      entityType: 'book',
      entityId: 'book_local',
      operationType: 'put',
      payload: backup,
      deviceId: 'device_local',
      createdAt: new Date().toISOString()
    });
  });

  if (manifest.report.totalCategories === 0) {
    throw new Error('Migration manifest is empty');
  }
}
```

- [ ] **Step 4: Run the migration tests**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm test -- --run tests/storage/legacyMigration.test.ts`
Expected: PASS with `2 passed`.

- [ ] **Step 5: Commit**

```bash
cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账
git add app/src/storage/migrations app/tests/fixtures/legacy app/tests/storage/legacyMigration.test.ts
git commit -m "feat: add deterministic legacy migration manifest"
```

## Task 5: Load or Create the Local Book Through Repositories

**Files:**
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/domain/bootstrap/loadOrCreateLocalBook.ts`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/src/app/bootstrap.ts`
- Test: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/domain/loadOrCreateLocalBook.test.ts`

- [ ] **Step 1: Write the failing bootstrap domain test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import { AssetTrackerDb } from '../../src/storage/db';
import { loadOrCreateLocalBook } from '../../src/domain/bootstrap/loadOrCreateLocalBook';

describe('loadOrCreateLocalBook', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-load-test');
    await db.delete();
    await db.open();
  });

  it('creates a default local book on first boot', async () => {
    const book = await loadOrCreateLocalBook(db);

    expect(book.id).toBe('book_local');
    expect(book.type).toBe('private');
    expect(book.baseCurrency).toBe('CNY');
  });
});
```

- [ ] **Step 2: Run the load/create test to verify it fails**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm test -- --run tests/domain/loadOrCreateLocalBook.test.ts`
Expected: FAIL because the domain loader does not exist.

- [ ] **Step 3: Implement the local-book bootstrap**

```ts
// /app/src/domain/bootstrap/loadOrCreateLocalBook.ts
import type { Book } from '../../shared/types/entities';
import { AssetTrackerDb } from '../../storage/db';

export async function loadOrCreateLocalBook(db: AssetTrackerDb): Promise<Book> {
  const existing = await db.books.get('book_local');

  if (existing) {
    return existing;
  }

  const now = new Date().toISOString();
  const book: Book = {
    id: 'book_local',
    name: 'Local Book',
    type: 'private',
    baseCurrency: 'CNY',
    revision: 1,
    deletedAt: null,
    updatedBy: 'local-user',
    deviceId: 'device_local',
    createdAt: now,
    updatedAt: now
  };

  await db.books.put(book);
  await db.operations.put({
    id: 'op_book_local_1',
    bookId: book.id,
    entityType: 'book',
    entityId: book.id,
    operationType: 'put',
    payload: JSON.stringify(book),
    deviceId: book.deviceId,
    createdAt: now
  });

  return book;
}
```

```ts
// /app/src/app/bootstrap.ts
import { AssetTrackerDb } from '../storage/db';
import { loadOrCreateLocalBook } from '../domain/bootstrap/loadOrCreateLocalBook';
import { buildShell } from './shell';

export async function bootstrapApp(target: HTMLElement): Promise<void> {
  const db = new AssetTrackerDb();
  await db.open();
  const book = await loadOrCreateLocalBook(db);

  target.innerHTML = '';
  const shell = buildShell();
  shell.querySelector('[data-role="boot-status"]')!.textContent = `Loaded ${book.name}`;
  target.appendChild(shell);
}
```

- [ ] **Step 4: Run the load/create test**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm test -- --run tests/domain/loadOrCreateLocalBook.test.ts tests/app/bootstrap.test.ts`
Expected: PASS with `2 passed`.

- [ ] **Step 5: Verify the app boots in dev mode**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm run dev -- --host 127.0.0.1 --strictPort`
Expected: Vite starts and the page shows `Loaded Local Book`.

- [ ] **Step 6: Commit**

```bash
cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账
git add app/src/domain app/src/app app/tests/domain
git commit -m "feat: bootstrap local book foundation"
```

## Task 6: Add Checkpoint 1 Acceptance Gates

**Files:**
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/storage/legacyMigration.test.ts`
- Modify: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/storage/revisionConflict.test.ts`
- Create: `/Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app/tests/checkpoint1.acceptance.test.ts`

- [ ] **Step 1: Write the failing checkpoint acceptance test**

```ts
import { beforeEach, describe, expect, it } from 'vitest';
import fixture from './fixtures/legacy/assetTrackerData.sample.json';
import { AssetTrackerDb } from '../src/storage/db';
import { buildLegacyMigrationManifest } from '../src/storage/migrations/legacyMigrationManifest';
import { loadOrCreateLocalBook } from '../src/domain/bootstrap/loadOrCreateLocalBook';

describe('checkpoint 1 acceptance', () => {
  let db: AssetTrackerDb;

  beforeEach(async () => {
    db = new AssetTrackerDb('asset-tracker-db-acceptance');
    await db.delete();
    await db.open();
  });

  it('produces a stable manifest and can still create the local book', async () => {
    const manifestA = buildLegacyMigrationManifest(fixture as never);
    const manifestB = buildLegacyMigrationManifest(fixture as never);

    expect(manifestA).toEqual(manifestB);

    const book = await loadOrCreateLocalBook(db);
    expect(book.id).toBe('book_local');
    expect(manifestA.report.totalCategories).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the acceptance test to verify it fails**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm test -- --run tests/checkpoint1.acceptance.test.ts`
Expected: FAIL until the manifest builder and bootstrap path are wired together cleanly.

- [ ] **Step 3: Tighten the migration and revision assertions**

```ts
// add to /app/tests/storage/legacyMigration.test.ts
it('returns the same IDs for the same legacy payload', () => {
  const manifestA = buildLegacyMigrationManifest(fixture as never);
  const manifestB = buildLegacyMigrationManifest(fixture as never);

  expect(manifestA.categoryPathToId).toEqual(manifestB.categoryPathToId);
});
```

```ts
// add to /app/tests/storage/revisionConflict.test.ts
it('writes an operation log entry on successful put', async () => {
  await repository.put({
    id: 'cat_002',
    bookId: 'book_local',
    parentId: null,
    name: '支付宝',
    kind: 'group',
    currency: 'CNY',
    sortOrder: 1,
    isArchived: false,
    revision: 1,
    deletedAt: null,
    updatedBy: 'local-user',
    deviceId: 'device_local',
    createdAt: '2026-04-13T00:00:00.000Z',
    updatedAt: '2026-04-13T00:00:00.000Z'
  });

  expect(await db.operations.count()).toBe(1);
});
```

- [ ] **Step 4: Run the full checkpoint 1 suite**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm test -- --run`
Expected: PASS with all checkpoint 1 tests green.

- [ ] **Step 5: Build the app one more time**

Run: `cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账/app && npm run build`
Expected: PASS and produce a build artifact after the full test suite passes.

- [ ] **Step 6: Commit**

```bash
cd /Users/joshua/Desktop/Qiushan_Studio/6_Personal/可视化记账
git add app/tests
git commit -m "test: add checkpoint1 acceptance coverage"
```

## Spec Coverage Check

- `Vite + TypeScript` app shell: covered by Task 1.
- Structured local database with `revision`, `deletedAt`, and `operations`: covered by Task 3.
- Deterministic legacy migration with path-based resolution and opening adjustments: covered by Task 4.
- Minimal local book boot flow: covered by Task 5.
- Checkpoint-style gating and stability assertions: covered by Task 6.

## Self-Review Notes

- The plan intentionally covers only checkpoint 1 from the spec, because the full phase 1 scope contains multiple subsystems and would create a low-signal mega-plan.
- Future checkpoint plans must build on `/app` instead of touching the legacy `/记账` source directly.
- No placeholder task names or undefined function names remain; all code references use exact file paths and concrete exports.
