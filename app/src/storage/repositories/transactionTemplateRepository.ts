import type { TransactionTemplate } from '../../shared/types/entities';
import type { OperationLogEntry } from '../db';
import { AssetTrackerDb } from '../db';

function buildPutOperation(template: TransactionTemplate): OperationLogEntry {
  return {
    id: `op_${template.id}_${template.revision}`,
    bookId: template.bookId,
    entityType: 'transactionTemplate',
    entityId: template.id,
    operationType: 'put',
    payload: JSON.stringify(template),
    deviceId: template.deviceId,
    createdAt: template.updatedAt
  };
}

export class TransactionTemplateRepository {
  constructor(private readonly db: AssetTrackerDb) {}

  listByBook(bookId: string): Promise<TransactionTemplate[]> {
    return this.db.transactionTemplates.where('bookId').equals(bookId).sortBy('updatedAt');
  }

  get(templateId: string): Promise<TransactionTemplate | undefined> {
    return this.db.transactionTemplates.get(templateId);
  }

  async put(template: TransactionTemplate): Promise<void> {
    await this.putMany([template]);
  }

  async putMany(templates: TransactionTemplate[]): Promise<void> {
    await this.db.transaction('rw', this.db.transactionTemplates, this.db.operations, async () => {
      for (const template of templates) {
        const existing = await this.db.transactionTemplates.get(template.id);

        if (existing && template.revision <= existing.revision) {
          throw new Error('Revision conflict');
        }
      }

      await this.db.transactionTemplates.bulkPut(templates);
      await this.db.operations.bulkPut(templates.map((template) => buildPutOperation(template)));
    });
  }
}
