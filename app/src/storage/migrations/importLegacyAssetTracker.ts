import type {
  AssetStateAnchor,
  AutomationRule,
  Book,
  Category,
  CurrencyCode,
  ExchangeRate,
  Transaction,
  TransactionDirection,
  TransactionTemplate
} from '../../shared/types/entities';
import { createMetadata, bumpMetadata } from '../../shared/utils/entityMetadata';
import { formatDateForDateInput, parseDateAndTimeToIso } from '../../shared/utils/datetimeLocal';
import { toMinorUnits } from '../../shared/utils/money';
import {
  assetStateAnchorSchema,
  automationRuleSchema,
  bookSchema,
  categorySchema,
  exchangeRateSchema,
  transactionSchema,
  transactionTemplateSchema
} from '../../shared/validation/schemas';
import type { OperationLogEntry } from '../db';
import { AssetTrackerDb } from '../db';
import { buildCategoryPath } from './legacyCategoryPath';
import { buildLegacyMigrationManifest } from './legacyMigrationManifest';
import { buildLegacyRawBackup } from './legacySnapshot';
import {
  parseLegacyAssetTrackerData,
  type LegacyAssetTrackerData,
  type LegacyAutomationRuleInput,
  type LegacyCategoryNode,
  type LegacyInitialAssetEntry,
  type LegacyTemplateInput,
  type LegacyTransactionInput
} from './types';

interface ImportLegacyAssetTrackerInput {
  bookId: string;
  payload: unknown;
}

interface LegacyCategoryVisit {
  path: string;
  parentPath: string | null;
  node: LegacyCategoryNode;
  sortOrder: number;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

function hasChildren(node: LegacyCategoryNode): boolean {
  return Boolean(node.children && Object.keys(node.children).length > 0);
}

function normalizeLegacyTimestamp(value: string | number | undefined, fallback: string): string {
  if (typeof value === 'number') {
    const date = new Date(value);
    return Number.isNaN(date.getTime()) ? fallback : date.toISOString();
  }

  if (typeof value !== 'string' || !value.trim()) {
    return fallback;
  }

  if (/^\d{4}-\d{2}-\d{2}$/.test(value)) {
    return parseDateAndTimeToIso(value, '00:00');
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(value)) {
    return parseDateAndTimeToIso(value.slice(0, 10), value.slice(11));
  }

  if (/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}$/.test(value)) {
    return parseDateAndTimeToIso(value.slice(0, 10), value.slice(11, 16));
  }

  const parsed = new Date(value);

  if (!Number.isNaN(parsed.getTime())) {
    return parsed.toISOString();
  }

  return fallback;
}

function extractRuleTimeOfDay(startDate: string): string {
  const match = startDate.match(/T(\d{2}:\d{2})/);
  return match ? match[1] : '00:00';
}

function normalizeRuleStartDate(startDate: string): string {
  if (/^\d{4}-\d{2}-\d{2}$/.test(startDate)) {
    return startDate;
  }

  const match = startDate.match(/^(\d{4}-\d{2}-\d{2})T/);
  return match ? match[1] : startDate.slice(0, 10);
}

function determineDirection(amount: number): TransactionDirection {
  return amount < 0 ? 'expense' : 'income';
}

function normalizeCategoryBalance(amount: number, kind: Category['kind']): number {
  if (kind === 'debt') {
    return Math.abs(amount) * -1;
  }

  return amount;
}

function convertAmountBetweenCurrencies(
  amount: number,
  sourceCurrency: CurrencyCode,
  targetCurrency: CurrencyCode,
  baseCurrency: CurrencyCode,
  exchangeRates: Partial<Record<CurrencyCode, number>>
): number {
  if (sourceCurrency === targetCurrency) {
    return amount;
  }

  const sourceRate = sourceCurrency === baseCurrency ? 1 : exchangeRates[sourceCurrency];
  const targetRate = targetCurrency === baseCurrency ? 1 : exchangeRates[targetCurrency];

  if (!sourceRate || !targetRate) {
    return amount;
  }

  return amount * sourceRate / targetRate;
}

function listLegacyCategories(categories: Record<string, LegacyCategoryNode>): LegacyCategoryVisit[] {
  const items: LegacyCategoryVisit[] = [];

  const walk = (
    siblings: Record<string, LegacyCategoryNode>,
    parentPath: string | null
  ): void => {
    Object.values(siblings).forEach((node, index) => {
      const path = buildCategoryPath(parentPath, node.name);
      items.push({
        path,
        parentPath,
        node,
        sortOrder: index
      });

      if (node.children) {
        walk(node.children, path);
      }
    });
  };

  walk(categories, null);
  return items;
}

function resolveLegacyPath(
  categories: Record<string, LegacyCategoryNode>,
  topCategoryName: string,
  subcategoryName?: string
): string | null {
  const topLevel = Object.values(categories).find((category) => category.name === topCategoryName);

  if (!topLevel) {
    return null;
  }

  const topPath = buildCategoryPath(null, topLevel.name);

  if (!subcategoryName) {
    return topPath;
  }

  const visit = (
    node: LegacyCategoryNode,
    currentPath: string
  ): string | null => {
    if (!node.children) {
      return null;
    }

    for (const child of Object.values(node.children)) {
      const childPath = buildCategoryPath(currentPath, child.name);

      if (child.name === subcategoryName) {
        return childPath;
      }

      const nested = visit(child, childPath);

      if (nested) {
        return nested;
      }
    }

    return null;
  };

  return visit(topLevel, topPath) ?? topPath;
}

function resolveLegacyInitialAssetMapPath(
  path: string,
  categoryPathToId: Record<string, string>
): string | null {
  if (categoryPathToId[path]) {
    return path;
  }

  const encoded = path
    .split('/')
    .filter(Boolean)
    .reduce<string | null>((parentPath, segment) => buildCategoryPath(parentPath, segment), null);

  return encoded && categoryPathToId[encoded] ? encoded : null;
}

function computeOpeningAnchorAt(transactions: Transaction[], exportTime: string | undefined): string {
  if (transactions.length === 0) {
    return normalizeLegacyTimestamp(exportTime, '1970-01-01T00:00:00.000Z');
  }

  const earliest = transactions.reduce((min, transaction) => {
    return transaction.occurredAt < min ? transaction.occurredAt : min;
  }, transactions[0]!.occurredAt);
  const openingAt = new Date(new Date(earliest).getTime() - 1000);

  return openingAt.toISOString();
}

function buildLegacyBackupOperation(
  input: unknown,
  createdAt: string,
  bookId: string
): OperationLogEntry {
  return {
    id: 'op_legacy_backup_1',
    bookId,
    entityType: 'book',
    entityId: bookId,
    operationType: 'put',
    payload: buildLegacyRawBackup(input),
    deviceId: 'device_local',
    createdAt
  };
}

function buildImportedBook(book: Book, parsed: LegacyAssetTrackerData, now: string): Book {
  return bookSchema.parse({
    ...book,
    baseCurrency: parsed.settings?.baseCurrency ?? book.baseCurrency,
    memo: parsed.memo ?? book.memo ?? '',
    ...bumpMetadata(book, now)
  });
}

function buildImportedCategories(
  parsed: LegacyAssetTrackerData,
  importedBook: Book,
  now: string
): { categories: Category[]; categoryByPath: Map<string, Category> } {
  const categoryVisits = listLegacyCategories(parsed.categories);
  const transactionPaths = new Set(
    parsed.transactions
      .map((transaction) => resolveLegacyPath(parsed.categories, transaction.category, transaction.subcategory))
      .filter((value): value is string => Boolean(value))
  );
  const templatePaths = new Set(
    (parsed.transactionTemplates ?? [])
      .map((template) => resolveLegacyPath(parsed.categories, template.category, template.subcategory))
      .filter((value): value is string => Boolean(value))
  );
  const rulePaths = new Set(
    (parsed.automationRules ?? [])
      .map((rule) => resolveLegacyPath(parsed.categories, rule.category, rule.subcategory))
      .filter((value): value is string => Boolean(value))
  );
  const directActivityPaths = new Set([...transactionPaths, ...templatePaths, ...rulePaths]);
  const categories = categoryVisits.map(({ path, parentPath, node, sortOrder }) => {
    const directBalance = typeof node.balance === 'number' && Math.abs(node.balance) > 0;
    const kind: Category['kind'] =
      hasChildren(node) && !directActivityPaths.has(path) && !directBalance
        ? 'group'
        : node.isDebt
          ? 'debt'
          : 'asset';

    return categorySchema.parse({
      id: `cat_${encodeURIComponent(path)}`,
      bookId: importedBook.id,
      parentId: parentPath ? `cat_${encodeURIComponent(parentPath)}` : null,
      name: node.name,
      kind,
      currency: node.currency ?? importedBook.baseCurrency,
      sortOrder,
      isArchived: false,
      ...createMetadata(now)
    });
  });

  return {
    categories,
    categoryByPath: new Map(categories.map((category) => [decodeURIComponent(category.id.slice(4)), category]))
  };
}

function buildImportedTransactions(
  parsed: LegacyAssetTrackerData,
  importedBook: Book,
  categoryByPath: Map<string, Category>
): Transaction[] {
  return parsed.transactions.flatMap((transaction, index) => {
    const fallback = parsed.exportTime ?? '1970-01-01T00:00:00.000Z';
    const occurredAt = normalizeLegacyTimestamp(
      transaction.timestamp ?? transaction.date,
      normalizeLegacyTimestamp(transaction.date, fallback)
    );
    const resolvedPath = resolveLegacyPath(
      parsed.categories,
      transaction.category,
      transaction.subcategory
    );

    if (!resolvedPath) {
      return [];
    }

    const category = categoryByPath.get(resolvedPath);

    if (!category || category.kind === 'group') {
      return [];
    }

    const convertedAmount = convertAmountBetweenCurrencies(
      transaction.amount,
      transaction.currency ?? category.currency,
      category.currency,
      importedBook.baseCurrency,
      parsed.settings?.exchangeRates ?? {}
    );
    const normalizedAmount = normalizeCategoryBalance(convertedAmount, category.kind);

    return [
      transactionSchema.parse({
        id: `txn_legacy_${encodeURIComponent(transaction.id || `${resolvedPath}-${index}`)}`,
        bookId: importedBook.id,
        categoryId: category.id,
        amount: toMinorUnits(Number(normalizedAmount.toFixed(2))),
        currency: category.currency,
        direction: determineDirection(normalizedAmount),
        purpose: transaction.purpose?.trim() || 'Legacy Import',
        description: transaction.description?.trim() || '',
        occurredAt,
        automationRuleId: null,
        automationOccurrenceDate: null,
        ...createMetadata(occurredAt)
      })
    ];
  });
}

function buildImportedTemplates(
  parsed: LegacyAssetTrackerData,
  importedBook: Book,
  categoryByPath: Map<string, Category>,
  now: string
): TransactionTemplate[] {
  return (parsed.transactionTemplates ?? []).flatMap((template, index) => {
    const resolvedPath = resolveLegacyPath(parsed.categories, template.category, template.subcategory);

    if (!resolvedPath) {
      return [];
    }

    const category = categoryByPath.get(resolvedPath);

    if (!category || category.kind === 'group') {
      return [];
    }

    const convertedAmount = convertAmountBetweenCurrencies(
      template.amount,
      template.currency ?? category.currency,
      category.currency,
      importedBook.baseCurrency,
      parsed.settings?.exchangeRates ?? {}
    );
    const normalizedAmount = normalizeCategoryBalance(convertedAmount, category.kind);

    return [
      transactionTemplateSchema.parse({
        id: `tpl_legacy_${encodeURIComponent(template.id || `${resolvedPath}-${index}`)}`,
        bookId: importedBook.id,
        name: template.name.trim() || `Legacy Template ${index + 1}`,
        categoryId: category.id,
        amount: toMinorUnits(Number(normalizedAmount.toFixed(2))),
        currency: category.currency,
        direction: determineDirection(normalizedAmount),
        purpose: template.purpose?.trim() || 'Legacy Import',
        description: template.description?.trim() || '',
        ...createMetadata(now)
      })
    ];
  });
}

function buildImportedRules(
  parsed: LegacyAssetTrackerData,
  importedBook: Book,
  categoryByPath: Map<string, Category>,
  now: string
): AutomationRule[] {
  return (parsed.automationRules ?? []).flatMap((rule, index) => {
    const resolvedPath = resolveLegacyPath(parsed.categories, rule.category, rule.subcategory);

    if (!resolvedPath) {
      return [];
    }

    const category = categoryByPath.get(resolvedPath);

    if (!category || category.kind === 'group') {
      return [];
    }

    const convertedAmount = convertAmountBetweenCurrencies(
      rule.amount,
      category.currency,
      category.currency,
      importedBook.baseCurrency,
      parsed.settings?.exchangeRates ?? {}
    );
    const normalizedAmount = normalizeCategoryBalance(convertedAmount, category.kind);

    return [
      automationRuleSchema.parse({
        id: `rule_legacy_${encodeURIComponent(rule.id || `${resolvedPath}-${index}`)}`,
        bookId: importedBook.id,
        name: rule.name.trim() || `Legacy Rule ${index + 1}`,
        categoryId: category.id,
        amount: toMinorUnits(Number(normalizedAmount.toFixed(2))),
        currency: category.currency,
        direction: determineDirection(normalizedAmount),
        purpose: 'Legacy Import',
        description: '',
        frequency: ['daily', 'weekly', 'monthly', 'yearly'].includes(rule.frequency)
          ? rule.frequency
          : 'monthly',
        interval: 1,
        startDate: normalizeRuleStartDate(rule.startDate),
        endDate: rule.endDate ? normalizeRuleStartDate(rule.endDate) : null,
        monthlyDays: [],
        includeLastDayOfMonth: false,
        timeOfDay: extractRuleTimeOfDay(rule.startDate),
        lastGeneratedAt: rule.lastExecuted
          ? normalizeLegacyTimestamp(rule.lastExecuted, now)
          : null,
        isActive: rule.active ?? true,
        ...createMetadata(now)
      })
    ];
  });
}

function buildImportedExchangeRates(
  parsed: LegacyAssetTrackerData,
  importedBook: Book,
  now: string
): ExchangeRate[] {
  const exchangeRates = parsed.settings?.exchangeRates;

  if (!exchangeRates || !isRecord(exchangeRates)) {
    return [];
  }

  return Object.entries(exchangeRates).flatMap(([currency, rate]) => {
    if (
      currency === importedBook.baseCurrency ||
      !['CNY', 'SGD', 'USD', 'MYR'].includes(currency) ||
      typeof rate !== 'number' ||
      rate <= 0
    ) {
      return [];
    }

    return [
      exchangeRateSchema.parse({
        id: `fx_${importedBook.id}_${currency}_${importedBook.baseCurrency}_${formatDateForDateInput(now)}`,
        bookId: importedBook.id,
        currency,
        baseCurrency: importedBook.baseCurrency,
        rate,
        effectiveFrom: formatDateForDateInput(now),
        ...createMetadata(now)
      })
    ];
  });
}

function buildImportedAnchors(
  parsed: LegacyAssetTrackerData,
  importedBook: Book,
  categoryByPath: Map<string, Category>,
  transactions: Transaction[],
  now: string
): AssetStateAnchor[] {
  const anchors: AssetStateAnchor[] = [];
  const coveredCategoryIds = new Set<string>();
  const openingAt = computeOpeningAnchorAt(transactions, parsed.exportTime);
  const transactionTotals = new Map<string, number>();
  const categoryCurrentBalances = new Map<string, number>();

  categoryByPath.forEach((category, path) => {
    const visit = listLegacyCategories(parsed.categories).find((item) => item.path === path);
    if (!visit || category.kind === 'group') {
      return;
    }

    categoryCurrentBalances.set(
      category.id,
      normalizeCategoryBalance(visit.node.balance ?? 0, category.kind)
    );
  });

  transactions.forEach((transaction) => {
    transactionTotals.set(
      transaction.categoryId,
      (transactionTotals.get(transaction.categoryId) ?? 0) + transaction.amount / 100
    );
  });

  if (Array.isArray(parsed.initialAssets)) {
    parsed.initialAssets.forEach((asset, index) => {
      const resolvedPath = resolveLegacyPath(parsed.categories, asset.category, asset.subcategory);

      if (!resolvedPath) {
        return;
      }

      const category = categoryByPath.get(resolvedPath);

      if (!category || category.kind === 'group') {
        return;
      }

      const convertedAmount = convertAmountBetweenCurrencies(
        asset.amount,
        asset.currency ?? category.currency,
        category.currency,
        importedBook.baseCurrency,
        parsed.settings?.exchangeRates ?? {}
      );
      const normalizedAmount = normalizeCategoryBalance(convertedAmount, category.kind);
      const anchoredAt = normalizeLegacyTimestamp(asset.time, openingAt);

      anchors.push(
        assetStateAnchorSchema.parse({
          id: `anchor_legacy_${encodeURIComponent(asset.id || `${category.id}-${index}`)}`,
          bookId: importedBook.id,
          categoryId: category.id,
          amount: toMinorUnits(Number(normalizedAmount.toFixed(2))),
          currency: category.currency,
          anchoredAt,
          note: asset.note?.trim() || 'Legacy asset state',
          ...createMetadata(asset.createdAt ? normalizeLegacyTimestamp(asset.createdAt, now) : now)
        })
      );
      coveredCategoryIds.add(category.id);
    });
  } else if (parsed.initialAssets) {
    Object.entries(parsed.initialAssets).forEach(([rawPath, amount], index) => {
      if (typeof amount !== 'number') {
        return;
      }

      const resolvedPath = resolveLegacyInitialAssetMapPath(rawPath, Object.fromEntries(
        [...categoryByPath.keys()].map((path) => [path, path])
      ));

      if (!resolvedPath) {
        return;
      }

      const category = categoryByPath.get(resolvedPath);

      if (!category || category.kind === 'group') {
        return;
      }

      anchors.push(
        assetStateAnchorSchema.parse({
          id: `anchor_legacy_opening_${encodeURIComponent(`${category.id}-${index}`)}`,
          bookId: importedBook.id,
          categoryId: category.id,
          amount: toMinorUnits(Number(normalizeCategoryBalance(amount, category.kind).toFixed(2))),
          currency: category.currency,
          anchoredAt: openingAt,
          note: 'Legacy opening balance',
          ...createMetadata(now)
        })
      );
      coveredCategoryIds.add(category.id);
    });
  }

  categoryCurrentBalances.forEach((currentBalance, categoryId) => {
    if (coveredCategoryIds.has(categoryId)) {
      return;
    }

    const transactionTotal = transactionTotals.get(categoryId) ?? 0;

    if (currentBalance === 0 && transactionTotal === 0) {
      return;
    }

    const category = [...categoryByPath.values()].find((item) => item.id === categoryId);

    if (!category) {
      return;
    }

    anchors.push(
      assetStateAnchorSchema.parse({
        id: `anchor_legacy_derived_${encodeURIComponent(categoryId)}`,
        bookId: importedBook.id,
        categoryId,
        amount: toMinorUnits(Number((currentBalance - transactionTotal).toFixed(2))),
        currency: category.currency,
        anchoredAt: openingAt,
        note: 'Derived from legacy balances',
        ...createMetadata(now)
      })
    );
  });

  return anchors.sort((left, right) => left.anchoredAt.localeCompare(right.anchoredAt));
}

export async function importLegacyAssetTracker(
  db: AssetTrackerDb,
  input: ImportLegacyAssetTrackerInput
): Promise<void> {
  const parsed = parseLegacyAssetTrackerData(input.payload);
  const manifest = buildLegacyMigrationManifest(parsed);

  if (manifest.report.totalCategories === 0) {
    throw new Error('Migration manifest is empty');
  }

  const book = await db.books.get(input.bookId);

  if (!book || book.deletedAt !== null) {
    throw new Error('Book does not exist');
  }

  const now = new Date().toISOString();
  const importedBook = buildImportedBook(book, parsed, now);
  const { categories, categoryByPath } = buildImportedCategories(parsed, importedBook, now);
  const transactions = buildImportedTransactions(parsed, importedBook, categoryByPath);
  const transactionTemplates = buildImportedTemplates(parsed, importedBook, categoryByPath, now);
  const automationRules = buildImportedRules(parsed, importedBook, categoryByPath, now);
  const exchangeRates = buildImportedExchangeRates(parsed, importedBook, now);
  const assetStateAnchors = buildImportedAnchors(parsed, importedBook, categoryByPath, transactions, now);
  const backupOperation = buildLegacyBackupOperation(
    input.payload,
    parsed.exportTime ?? now,
    input.bookId
  );

  await db.transaction(
    'rw',
    [
      db.books,
      db.categories,
      db.transactions,
      db.transactionTemplates,
      db.automationRules,
      db.exchangeRates,
      db.assetStateAnchors,
      db.operations
    ],
    async () => {
      await db.books.put(importedBook);
      await db.categories.where('bookId').equals(input.bookId).delete();
      await db.transactions.where('bookId').equals(input.bookId).delete();
      await db.transactionTemplates.where('bookId').equals(input.bookId).delete();
      await db.automationRules.where('bookId').equals(input.bookId).delete();
      await db.exchangeRates.where('bookId').equals(input.bookId).delete();
      await db.assetStateAnchors.where('bookId').equals(input.bookId).delete();
      await db.operations.where('bookId').equals(input.bookId).delete();
      await db.categories.bulkPut(categories);
      await db.transactions.bulkPut(transactions);
      await db.transactionTemplates.bulkPut(transactionTemplates);
      await db.automationRules.bulkPut(automationRules);
      await db.exchangeRates.bulkPut(exchangeRates);
      await db.assetStateAnchors.bulkPut(assetStateAnchors);
      await db.operations.put(backupOperation);
    }
  );
}
