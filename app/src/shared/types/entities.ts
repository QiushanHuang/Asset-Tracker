import type { EntityMetadata } from './metadata';

export type CurrencyCode = 'CNY' | 'SGD' | 'USD' | 'MYR';
declare const monetaryAmountBrand: unique symbol;

export type MonetaryAmount = number & {
  readonly [monetaryAmountBrand]: 'minor-unit-amount';
};

export type TransactionDirection = 'income' | 'expense' | 'transfer' | 'adjustment';
export type AutomationFrequency = 'daily' | 'weekly' | 'monthly' | 'yearly';

export interface Book extends EntityMetadata {
  id: string;
  name: string;
  type: 'private';
  baseCurrency: CurrencyCode;
  memo: string;
}

export interface Category extends EntityMetadata {
  id: string;
  bookId: string;
  parentId: string | null;
  name: string;
  kind: 'asset' | 'debt' | 'group';
  currency: CurrencyCode;
  sortOrder: number;
  isArchived: boolean;
}

export interface Transaction extends EntityMetadata {
  id: string;
  bookId: string;
  categoryId: string;
  // Persist money in minor units to avoid floating-point drift during bookkeeping math.
  amount: MonetaryAmount;
  currency: CurrencyCode;
  direction: TransactionDirection;
  purpose: string;
  description: string;
  occurredAt: string;
  automationRuleId?: string | null;
  automationOccurrenceDate?: string | null;
}

export interface TransactionTemplate extends EntityMetadata {
  id: string;
  bookId: string;
  name: string;
  categoryId: string;
  amount: MonetaryAmount;
  currency: CurrencyCode;
  direction: TransactionDirection;
  purpose: string;
  description: string;
}

export interface AutomationRule extends EntityMetadata {
  id: string;
  bookId: string;
  name: string;
  categoryId: string;
  amount: MonetaryAmount;
  currency: CurrencyCode;
  direction: TransactionDirection;
  purpose: string;
  description: string;
  frequency: AutomationFrequency;
  interval: number;
  startDate: string;
  endDate: string | null;
  monthlyDays: number[];
  includeLastDayOfMonth: boolean;
  timeOfDay: string;
  lastGeneratedAt: string | null;
  isActive: boolean;
}

export interface ExchangeRate extends EntityMetadata {
  id: string;
  bookId: string;
  currency: CurrencyCode;
  baseCurrency: CurrencyCode;
  rate: number;
  effectiveFrom: string;
}

export interface AssetStateAnchor extends EntityMetadata {
  id: string;
  bookId: string;
  categoryId: string;
  amount: MonetaryAmount;
  currency: CurrencyCode;
  anchoredAt: string;
  note: string;
}
