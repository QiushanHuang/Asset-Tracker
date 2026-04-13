import type { CurrencyCode } from '../../shared/types/entities';

export interface LegacyCategoryNode {
  id: string;
  name: string;
  balance?: number;
  currency?: CurrencyCode;
  isDebt?: boolean;
  collapsed?: boolean;
  children?: Record<string, LegacyCategoryNode>;
}

export interface LegacyTransactionInput {
  id: string;
  date: string;
  category: string;
  subcategory?: string;
  amount: number;
  currency?: CurrencyCode;
  type?: string;
  purpose?: string;
  description?: string;
  includeTime?: boolean;
  timestamp?: string | number;
}

export interface LegacyAutomationRuleInput {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  amount: number;
  frequency: string;
  startDate: string;
  endDate?: string;
  lastExecuted?: string;
  active?: boolean;
}

export interface LegacyTemplateInput {
  id: string;
  name: string;
  category: string;
  subcategory?: string;
  amount: number;
  currency?: CurrencyCode;
  type?: string;
  purpose?: string;
  description?: string;
}

export interface LegacySettingsInput {
  baseCurrency?: CurrencyCode;
  exchangeRates?: Partial<Record<CurrencyCode, number>>;
  autoBackup?: boolean;
  backupInterval?: number;
  autoExportData?: boolean;
}

export interface LegacyAssetTrackerData {
  categories: Record<string, LegacyCategoryNode>;
  transactions: LegacyTransactionInput[];
  automationRules?: LegacyAutomationRuleInput[];
  purposeCategories?: string[];
  initialAssets?: Record<string, number>;
  memo?: string;
  transactionTemplates?: LegacyTemplateInput[];
  settings?: LegacySettingsInput;
  exportTime?: string;
  version?: string;
}

export interface LegacyOpeningAdjustment {
  categoryPath: string;
  amount: number;
}

export interface LegacyMigrationReport {
  totalCategories: number;
  totalTransactions: number;
  totalOpeningAdjustments: number;
}

export interface LegacyMigrationManifest {
  categoryPathToId: Record<string, string>;
  openingAdjustments: LegacyOpeningAdjustment[];
  report: LegacyMigrationReport;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null;
}

export function parseLegacyAssetTrackerData(input: unknown): LegacyAssetTrackerData {
  if (!isRecord(input)) {
    throw new Error('Invalid legacy asset tracker data');
  }

  if (!isRecord(input.categories) || !Array.isArray(input.transactions)) {
    throw new Error('Invalid legacy asset tracker data');
  }

  return {
    categories: input.categories as Record<string, LegacyCategoryNode>,
    transactions: input.transactions as LegacyTransactionInput[],
    automationRules: Array.isArray(input.automationRules)
      ? (input.automationRules as LegacyAutomationRuleInput[])
      : undefined,
    purposeCategories: Array.isArray(input.purposeCategories)
      ? (input.purposeCategories as string[])
      : undefined,
    initialAssets: isRecord(input.initialAssets)
      ? (input.initialAssets as Record<string, number>)
      : undefined,
    memo: typeof input.memo === 'string' ? input.memo : undefined,
    transactionTemplates: Array.isArray(input.transactionTemplates)
      ? (input.transactionTemplates as LegacyTemplateInput[])
      : undefined,
    settings: isRecord(input.settings) ? (input.settings as LegacySettingsInput) : undefined,
    exportTime: typeof input.exportTime === 'string' ? input.exportTime : undefined,
    version: typeof input.version === 'string' ? input.version : undefined
  };
}
