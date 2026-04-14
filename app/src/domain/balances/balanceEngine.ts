import type {
  AssetStateAnchor,
  Book,
  Category,
  CurrencyCode,
  ExchangeRate,
  Transaction
} from '../../shared/types/entities';
import { AssetTrackerDb } from '../../storage/db';
import { AssetStateAnchorRepository } from '../../storage/repositories/assetStateAnchorRepository';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';
import { ExchangeRateRepository } from '../../storage/repositories/exchangeRateRepository';
import { TransactionRepository } from '../../storage/repositories/transactionRepository';
import { resolveExchangeRateAt } from '../settings/exchangeRateTimeline';

export interface CurrencySummaryBreakdown {
  currency: string;
  assetAmount: number;
  debtAmount: number;
  netAmount: number;
  convertedNetAmount: number | null;
}

export interface BookSummarySnapshot {
  netAmount: number;
  assetAmount: number;
  debtAmount: number;
  transactionCount: number;
  unresolvedCurrencies: string[];
  currencyBreakdown: CurrencySummaryBreakdown[];
}

export interface LeafCategoryBalance {
  categoryId: string;
  name: string;
  parentId: string | null;
  currency: CurrencyCode;
  kind: 'asset' | 'debt';
  amount: number;
}

export interface BalanceContext {
  book: Book;
  categories: Category[];
  transactions: Transaction[];
  exchangeRates: ExchangeRate[];
  assetStateAnchors: AssetStateAnchor[];
}

export interface CategoryTreeSnapshotItem {
  id: string;
  name: string;
  parentId: string | null;
  depth: number;
  kind: 'asset' | 'debt' | 'group';
  currency: CurrencyCode;
  aggregateAmount: number | null;
  sortOrder: number;
}

export async function loadBalanceContext(
  db: AssetTrackerDb,
  bookId: string
): Promise<BalanceContext> {
  const book = await db.books.get(bookId);

  if (!book || book.deletedAt !== null) {
    throw new Error('Book does not exist');
  }

  const [categories, transactions, exchangeRates, assetStateAnchors] = await Promise.all([
    new CategoryRepository(db).listByBook(bookId),
    new TransactionRepository(db).listByBook(bookId),
    new ExchangeRateRepository(db).listByBook(bookId),
    new AssetStateAnchorRepository(db).listByBook(bookId)
  ]);

  return {
    book,
    categories: categories.filter((item) => item.deletedAt === null),
    transactions: transactions.filter((item) => item.deletedAt === null),
    exchangeRates: exchangeRates.filter((item) => item.deletedAt === null),
    assetStateAnchors: assetStateAnchors.filter((item) => item.deletedAt === null)
  };
}

function buildTransactionsByCategory(transactions: Transaction[]): Map<string, Transaction[]> {
  const map = new Map<string, Transaction[]>();

  for (const transaction of transactions) {
    const items = map.get(transaction.categoryId) ?? [];
    items.push(transaction);
    map.set(transaction.categoryId, items);
  }

  map.forEach((items) => {
    items.sort((left, right) => left.occurredAt.localeCompare(right.occurredAt));
  });

  return map;
}

function buildAnchorsByCategory(anchors: AssetStateAnchor[]): Map<string, AssetStateAnchor[]> {
  const map = new Map<string, AssetStateAnchor[]>();

  for (const anchor of anchors) {
    const items = map.get(anchor.categoryId) ?? [];
    items.push(anchor);
    map.set(anchor.categoryId, items);
  }

  map.forEach((items) => {
    items.sort((left, right) => left.anchoredAt.localeCompare(right.anchoredAt));
  });

  return map;
}

export function listLeafCategoryBalancesAt(
  context: BalanceContext,
  asOf: string
): LeafCategoryBalance[] {
  const transactionsByCategory = buildTransactionsByCategory(context.transactions);
  const anchorsByCategory = buildAnchorsByCategory(context.assetStateAnchors);

  return context.categories
    .filter((category): category is Category & { kind: 'asset' | 'debt' } => category.kind !== 'group')
    .map((category) => {
      const transactions = transactionsByCategory.get(category.id) ?? [];
      const anchors = anchorsByCategory.get(category.id) ?? [];
      const activeAnchor = [...anchors]
        .reverse()
        .find((anchor) => anchor.anchoredAt <= asOf);
      const amount = transactions.reduce((total, transaction) => {
        if (transaction.occurredAt > asOf) {
          return total;
        }

        if (activeAnchor && transaction.occurredAt < activeAnchor.anchoredAt) {
          return total;
        }

        return total + transaction.amount;
      }, activeAnchor?.amount ?? 0);

      return {
        categoryId: category.id,
        name: category.name,
        parentId: category.parentId,
        currency: category.currency,
        kind: category.kind,
        amount
      };
    });
}

export function summarizeBookBalancesAt(
  context: BalanceContext,
  asOf: string
): BookSummarySnapshot {
  const leafBalances = listLeafCategoryBalancesAt(context, asOf);
  const rawBreakdown = new Map<CurrencyCode, { assetAmount: number; debtAmount: number }>();

  for (const balance of leafBalances) {
    if (balance.amount === 0) {
      continue;
    }

    const totals = rawBreakdown.get(balance.currency) ?? { assetAmount: 0, debtAmount: 0 };

    if (balance.kind === 'debt') {
      if (balance.amount < 0) {
        totals.debtAmount += Math.abs(balance.amount);
      } else {
        totals.assetAmount += balance.amount;
      }
    } else {
      totals.assetAmount += balance.amount;
    }

    rawBreakdown.set(balance.currency, totals);
  }

  let assetAmount = 0;
  let debtAmount = 0;
  const unresolvedCurrencies: string[] = [];
  const currencyBreakdown: CurrencySummaryBreakdown[] = [];

  rawBreakdown.forEach((totals, currency) => {
    const netAmount = totals.assetAmount - totals.debtAmount;
    const rate =
      currency === context.book.baseCurrency
        ? 1
        : resolveExchangeRateAt(context.exchangeRates, context.book.baseCurrency, currency, asOf)?.rate;
    const convertedNetAmount = rate ? Math.round(netAmount * rate) : null;

    if (rate) {
      assetAmount += Math.round(totals.assetAmount * rate);
      debtAmount += Math.round(totals.debtAmount * rate);
    } else {
      unresolvedCurrencies.push(currency);
    }

    currencyBreakdown.push({
      currency,
      assetAmount: totals.assetAmount,
      debtAmount: totals.debtAmount,
      netAmount,
      convertedNetAmount
    });
  });

  return {
    netAmount: assetAmount - debtAmount,
    assetAmount,
    debtAmount,
    transactionCount: context.transactions.filter((transaction) => transaction.occurredAt <= asOf).length,
    unresolvedCurrencies: unresolvedCurrencies.sort(),
    currencyBreakdown: currencyBreakdown.sort((left, right) => left.currency.localeCompare(right.currency))
  };
}

export function buildCategoryTreeSnapshot(
  context: BalanceContext,
  asOf: string
): CategoryTreeSnapshotItem[] {
  const activeCategories = [...context.categories].sort((left, right) => {
    if (left.parentId === right.parentId) {
      return left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt);
    }

    return (left.parentId ?? '').localeCompare(right.parentId ?? '');
  });
  const childrenByParent = new Map<string | null, Category[]>();
  const leafBalances = listLeafCategoryBalancesAt(context, asOf);
  const leafAmountByCategory = new Map(leafBalances.map((item) => [item.categoryId, item.amount]));

  for (const category of activeCategories) {
    const siblings = childrenByParent.get(category.parentId) ?? [];
    siblings.push(category);
    childrenByParent.set(category.parentId, siblings);
  }

  const items: CategoryTreeSnapshotItem[] = [];

  const walk = (parentId: string | null, depth: number): { amount: number; mixed: boolean } => {
    const siblings = (childrenByParent.get(parentId) ?? []).sort(
      (left, right) => left.sortOrder - right.sortOrder || left.createdAt.localeCompare(right.createdAt)
    );
    let subtotal = 0;
    let mixed = false;

    siblings.forEach((category) => {
      const itemIndex = items.length;
      items.push({
        id: category.id,
        name: category.name,
        parentId: category.parentId,
        depth,
        kind: category.kind,
        currency: category.currency,
        aggregateAmount: 0,
        sortOrder: category.sortOrder
      });

      const ownAmount = leafAmountByCategory.get(category.id) ?? 0;
      const descendantState = walk(category.id, depth + 1);
      const childCurrencies = (childrenByParent.get(category.id) ?? []).map((child) => child.currency);
      const hasMixedChildCurrency =
        descendantState.mixed || childCurrencies.some((childCurrency) => childCurrency !== category.currency);

      if (hasMixedChildCurrency) {
        items[itemIndex]!.aggregateAmount = null;
        mixed = true;
        return;
      }

      const aggregateAmount = ownAmount + descendantState.amount;
      items[itemIndex]!.aggregateAmount = aggregateAmount;
      subtotal += aggregateAmount;
    });

    return {
      amount: subtotal,
      mixed
    };
  };

  walk(null, 0);

  return items;
}
