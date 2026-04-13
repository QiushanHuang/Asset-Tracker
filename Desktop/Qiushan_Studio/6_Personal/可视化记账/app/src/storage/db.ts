import Dexie, { type Table } from 'dexie';
import type { Book, Category, Transaction } from '../shared/types/entities';
import { DB_NAME, DB_VERSION, storeDefinitions } from './schema';

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

  constructor(name = DB_NAME) {
    super(name);

    this.version(DB_VERSION).stores(storeDefinitions);
  }
}
