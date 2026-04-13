export const DB_NAME = 'asset-tracker-db';
export const DB_VERSION = 1;

export const storeDefinitions = {
  books: '&id, updatedAt, deletedAt',
  categories: '&id, bookId, parentId, sortOrder, updatedAt, deletedAt',
  transactions: '&id, bookId, categoryId, occurredAt, updatedAt, deletedAt',
  operations: '&id, bookId, entityType, entityId, createdAt'
} as const;
