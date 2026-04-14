import { AssetTrackerDb } from '../../storage/db';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';
import { TransactionRepository } from '../../storage/repositories/transactionRepository';
import { formatDateForDateInput } from '../../shared/utils/datetimeLocal';

export interface TransactionListItem {
  id: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  currency: 'CNY' | 'SGD' | 'USD' | 'MYR';
  direction: 'income' | 'expense' | 'transfer' | 'adjustment';
  purpose: string;
  description: string;
  occurredAt: string;
}

export interface ListTransactionsForBookOptions {
  year?: string;
  month?: string;
  date?: string;
  categoryId?: string;
  purpose?: string;
  direction?: 'income' | 'expense' | 'transfer' | 'adjustment' | 'all';
  sortBy?: 'occurredAt-desc' | 'occurredAt-asc' | 'amount-desc' | 'amount-asc';
}

function normalizeMonth(value: string): string {
  return value.padStart(2, '0');
}

function matchesFilters(item: TransactionListItem, filters: ListTransactionsForBookOptions): boolean {
  const occurredDate = formatDateForDateInput(item.occurredAt);
  const purposeQuery = filters.purpose?.trim().toLocaleLowerCase();

  if (filters.date && occurredDate !== filters.date) {
    return false;
  }

  if (filters.year && occurredDate.slice(0, 4) !== filters.year) {
    return false;
  }

  if (filters.month && occurredDate.slice(5, 7) !== normalizeMonth(filters.month)) {
    return false;
  }

  if (filters.categoryId && item.categoryId !== filters.categoryId) {
    return false;
  }

  if (filters.direction && filters.direction !== 'all' && item.direction !== filters.direction) {
    return false;
  }

  if (purposeQuery && !item.purpose.toLocaleLowerCase().includes(purposeQuery)) {
    return false;
  }

  return true;
}

function sortTransactions(
  left: TransactionListItem,
  right: TransactionListItem,
  sortBy: NonNullable<ListTransactionsForBookOptions['sortBy']>
): number {
  if (sortBy === 'occurredAt-asc') {
    return left.occurredAt.localeCompare(right.occurredAt);
  }

  if (sortBy === 'amount-desc') {
    return Math.abs(right.amount) - Math.abs(left.amount) || right.occurredAt.localeCompare(left.occurredAt);
  }

  if (sortBy === 'amount-asc') {
    return Math.abs(left.amount) - Math.abs(right.amount) || right.occurredAt.localeCompare(left.occurredAt);
  }

  return right.occurredAt.localeCompare(left.occurredAt);
}

export async function listTransactionsForBook(
  db: AssetTrackerDb,
  bookId: string,
  options: ListTransactionsForBookOptions = {}
): Promise<TransactionListItem[]> {
  const transactionRepository = new TransactionRepository(db);
  const categoryRepository = new CategoryRepository(db);
  const [transactions, categories] = await Promise.all([
    transactionRepository.listByBook(bookId),
    categoryRepository.listByBook(bookId)
  ]);
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));

  return transactions
    .filter((item) => item.deletedAt === null)
    .map((transaction) => ({
      id: transaction.id,
      categoryId: transaction.categoryId,
      categoryName: categoryNameById.get(transaction.categoryId) ?? '未知分类',
      amount: transaction.amount,
      currency: transaction.currency,
      direction: transaction.direction,
      purpose: transaction.purpose,
      description: transaction.description,
      occurredAt: transaction.occurredAt
    }))
    .filter((item) => matchesFilters(item, options))
    .sort((left, right) => sortTransactions(left, right, options.sortBy ?? 'occurredAt-desc'));
}
