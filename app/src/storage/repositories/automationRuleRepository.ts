import type { AutomationRule } from '../../shared/types/entities';
import type { OperationLogEntry } from '../db';
import { AssetTrackerDb } from '../db';

function buildPutOperation(rule: AutomationRule): OperationLogEntry {
  return {
    id: `op_${rule.id}_${rule.revision}`,
    bookId: rule.bookId,
    entityType: 'automationRule',
    entityId: rule.id,
    operationType: 'put',
    payload: JSON.stringify(rule),
    deviceId: rule.deviceId,
    createdAt: rule.updatedAt
  };
}

export class AutomationRuleRepository {
  constructor(private readonly db: AssetTrackerDb) {}

  listByBook(bookId: string): Promise<AutomationRule[]> {
    return this.db.automationRules.where('bookId').equals(bookId).sortBy('updatedAt');
  }

  get(ruleId: string): Promise<AutomationRule | undefined> {
    return this.db.automationRules.get(ruleId);
  }

  async put(rule: AutomationRule): Promise<void> {
    await this.putMany([rule]);
  }

  async putMany(rules: AutomationRule[]): Promise<void> {
    await this.db.transaction('rw', this.db.automationRules, this.db.operations, async () => {
      for (const rule of rules) {
        const existing = await this.db.automationRules.get(rule.id);

        if (existing && rule.revision <= existing.revision) {
          throw new Error('Revision conflict');
        }
      }

      await this.db.automationRules.bulkPut(rules);
      await this.db.operations.bulkPut(rules.map((rule) => buildPutOperation(rule)));
    });
  }
}
