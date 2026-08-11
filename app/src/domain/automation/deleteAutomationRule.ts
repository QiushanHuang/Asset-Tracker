import { markDeleted } from '../../shared/utils/entityMetadata';
import { AssetTrackerDb } from '../../storage/db';
import { AutomationRuleRepository } from '../../storage/repositories/automationRuleRepository';

export interface DeleteAutomationRuleInput {
  bookId: string;
  ruleId: string;
}

export async function deleteAutomationRule(
  db: AssetTrackerDb,
  input: DeleteAutomationRuleInput
): Promise<void> {
  const repository = new AutomationRuleRepository(db);
  const rule = await repository.get(input.ruleId);

  if (!rule || rule.bookId !== input.bookId || rule.deletedAt !== null) {
    throw new Error('Automation rule does not exist');
  }

  await repository.put({
    ...rule,
    ...markDeleted(rule)
  });
}
