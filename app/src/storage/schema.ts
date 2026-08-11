export const DB_NAME = 'asset-tracker-db';
export const DB_VERSION = 4;

export const storeDefinitionsV3 = {
  books: '&id, updatedAt, deletedAt',
  categories: '&id, bookId, parentId, sortOrder, updatedAt, deletedAt',
  transactions: '&id, bookId, categoryId, occurredAt, updatedAt, deletedAt',
  transactionTemplates: '&id, bookId, categoryId, updatedAt, deletedAt',
  automationRules: '&id, bookId, categoryId, frequency, updatedAt, deletedAt',
  exchangeRates: '&id, bookId, currency, updatedAt, deletedAt',
  assetStateAnchors: '&id, bookId, categoryId, anchoredAt, updatedAt, deletedAt',
  operations: '&id, bookId, entityType, entityId, createdAt'
} as const;

export const storeDefinitions = {
  books: '&id, updatedAt, deletedAt',
  categories: '&id, bookId, parentId, sortOrder, updatedAt, deletedAt',
  transactions: '&id, bookId, categoryId, occurredAt, updatedAt, deletedAt',
  transactionTemplates: '&id, bookId, categoryId, updatedAt, deletedAt',
  automationRules: '&id, bookId, categoryId, frequency, updatedAt, deletedAt',
  exchangeRates: '&id, bookId, [bookId+currency], effectiveFrom, updatedAt, deletedAt',
  assetStateAnchors: '&id, bookId, categoryId, anchoredAt, updatedAt, deletedAt',
  operations: '&id, bookId, entityType, entityId, createdAt'
} as const;
