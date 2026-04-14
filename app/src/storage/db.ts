import Dexie, { type Table } from 'dexie';
import type {
  AssetStateAnchor,
  AutomationRule,
  Book,
  Category,
  ExchangeRate,
  Transaction,
  TransactionTemplate
} from '../shared/types/entities';
import { DB_NAME, DB_VERSION, storeDefinitions, storeDefinitionsV3 } from './schema';

export interface OperationLogEntry {
  id: string;
  bookId: string;
  entityType:
    | 'book'
    | 'category'
    | 'transaction'
    | 'transactionTemplate'
    | 'automationRule'
    | 'exchangeRate'
    | 'assetStateAnchor';
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
  transactionTemplates!: Table<TransactionTemplate, string>;
  automationRules!: Table<AutomationRule, string>;
  exchangeRates!: Table<ExchangeRate, string>;
  assetStateAnchors!: Table<AssetStateAnchor, string>;
  operations!: Table<OperationLogEntry, string>;

  constructor(name = DB_NAME) {
    super(name);

    this.version(3).stores(storeDefinitionsV3);
    this.version(DB_VERSION)
      .stores(storeDefinitions)
      .upgrade(async (transaction) => {
        await transaction
          .table('exchangeRates')
          .toCollection()
          .modify((exchangeRate: Record<string, unknown>) => {
            const fallbackDate =
              (typeof exchangeRate.updatedAt === 'string' && exchangeRate.updatedAt.slice(0, 10)) ||
              (typeof exchangeRate.createdAt === 'string' && exchangeRate.createdAt.slice(0, 10)) ||
              new Date().toISOString().slice(0, 10);

            if (
              typeof exchangeRate.effectiveFrom !== 'string' ||
              !/^\d{4}-\d{2}-\d{2}$/.test(exchangeRate.effectiveFrom)
            ) {
              exchangeRate.effectiveFrom = fallbackDate;
            }
          });
      });
  }
}
