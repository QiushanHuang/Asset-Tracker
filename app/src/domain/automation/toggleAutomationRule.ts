import type { AutomationRule } from '../../shared/types/entities';
import { automationRuleSchema } from '../../shared/validation/schemas';
import { bumpMetadata } from '../../shared/utils/entityMetadata';
import { AssetTrackerDb } from '../../storage/db';
import { AutomationRuleRepository } from '../../storage/repositories/automationRuleRepository';
import { normalizeMonthlyDays, resolveTimeOfDay } from './schedule';

export interface ToggleAutomationRuleInput {
  bookId: string;
  ruleId: string;
  isActive: boolean;
}

export async function toggleAutomationRule(
  db: AssetTrackerDb,
  input: ToggleAutomationRuleInput
): Promise<AutomationRule> {
  const repository = new AutomationRuleRepository(db);
  const rule = await repository.get(input.ruleId);

  if (!rule || rule.bookId !== input.bookId || rule.deletedAt !== null) {
    throw new Error('Automation rule does not exist');
  }

  const updated = automationRuleSchema.parse({
    ...rule,
    monthlyDays: normalizeMonthlyDays(rule.monthlyDays),
    includeLastDayOfMonth: rule.includeLastDayOfMonth ?? false,
    timeOfDay: resolveTimeOfDay(rule.timeOfDay),
    isActive: input.isActive,
    ...bumpMetadata(rule)
  });

  await repository.put(updated);

  return updated;
}
