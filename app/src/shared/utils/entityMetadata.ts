import type { EntityMetadata } from '../types/metadata';

const LOCAL_UPDATED_BY = 'local-user';
const LOCAL_DEVICE_ID = 'device_local';

export function createMetadata(now = new Date().toISOString()): EntityMetadata {
  return {
    revision: 1,
    deletedAt: null,
    updatedBy: LOCAL_UPDATED_BY,
    deviceId: LOCAL_DEVICE_ID,
    createdAt: now,
    updatedAt: now
  };
}

export function bumpMetadata<T extends EntityMetadata>(entity: T, now = new Date().toISOString()): EntityMetadata {
  return {
    revision: entity.revision + 1,
    deletedAt: entity.deletedAt,
    updatedBy: LOCAL_UPDATED_BY,
    deviceId: LOCAL_DEVICE_ID,
    createdAt: entity.createdAt,
    updatedAt: now
  };
}

export function markDeleted<T extends EntityMetadata>(entity: T, now = new Date().toISOString()): EntityMetadata {
  return {
    ...bumpMetadata(entity, now),
    deletedAt: now
  };
}
