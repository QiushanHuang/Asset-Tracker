import type {
  AutomationFrequency,
  AutomationRule,
  CurrencyCode,
  TransactionDirection
} from '../../shared/types/entities';
import { automationRuleSchema } from '../../shared/validation/schemas';
import { bumpMetadata } from '../../shared/utils/entityMetadata';
import { toMinorUnits } from '../../shared/utils/money';
import { AssetTrackerDb } from '../../storage/db';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';
import { AutomationRuleRepository } from '../../storage/repositories/automationRuleRepository';
import { normalizeTransactionAmount } from '../transactions/createTransaction';
import { normalizeMonthlyDays, resolveTimeOfDay } from './schedule';

export interface UpdateAutomationRuleInput {
  bookId: string;
  ruleId: string;
  name: string;
  categoryId: string;
  amount: number;
  currency: CurrencyCode;
  direction: TransactionDirection;
  purpose: string;
  description: string;
  frequency: AutomationFrequency;
  interval: number;
  startDate: string;
  endDate: string | null;
  monthlyDays?: number[];
  includeLastDayOfMonth?: boolean;
  timeOfDay?: string;
  isActive: boolean;
}

export async function updateAutomationRule(
  db: AssetTrackerDb,
  input: UpdateAutomationRuleInput
): Promise<AutomationRule> {
  const ruleRepository = new AutomationRuleRepository(db);
  const categoryRepository = new CategoryRepository(db);
  const [rule, rules, categories] = await Promise.all([
    ruleRepository.get(input.ruleId),
    ruleRepository.listByBook(input.bookId),
    categoryRepository.listByBook(input.bookId)
  ]);

  if (!rule || rule.deletedAt !== null) {
    throw new Error('Automation rule does not exist');
  }

  const category = categories.find((item) => item.id === input.categoryId && item.deletedAt === null);
  const normalizedName = input.name.trim();

  if (!category) {
    throw new Error('Category does not exist');
  }

  if (category.kind === 'group') {
    throw new Error('Cannot automate a group category');
  }

  if (category.currency !== input.currency) {
    throw new Error('Automation currency must match category currency');
  }

  if (
    rules.some((item) => item.id !== rule.id && item.deletedAt === null && item.name === normalizedName)
  ) {
    throw new Error('Automation rule already exists');
  }

  const now = new Date().toISOString();
  const updated = automationRuleSchema.parse({
    ...rule,
    name: normalizedName,
    categoryId: input.categoryId,
    amount: toMinorUnits(normalizeTransactionAmount(input.amount, input.direction)),
    currency: input.currency,
    direction: input.direction,
    purpose: input.purpose.trim(),
    description: input.description.trim(),
    frequency: input.frequency,
    interval: input.interval,
    startDate: input.startDate,
    endDate: input.endDate,
    monthlyDays: normalizeMonthlyDays(input.monthlyDays),
    includeLastDayOfMonth: input.includeLastDayOfMonth ?? false,
    timeOfDay: resolveTimeOfDay(input.timeOfDay),
    isActive: input.isActive,
    ...bumpMetadata(rule, now)
  });

  await ruleRepository.put(updated);

  return updated;
}
