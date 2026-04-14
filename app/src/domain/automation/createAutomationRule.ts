import type {
  AutomationFrequency,
  AutomationRule,
  CurrencyCode,
  TransactionDirection
} from '../../shared/types/entities';
import { automationRuleSchema } from '../../shared/validation/schemas';
import { createMetadata } from '../../shared/utils/entityMetadata';
import { toMinorUnits } from '../../shared/utils/money';
import { AssetTrackerDb } from '../../storage/db';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';
import { AutomationRuleRepository } from '../../storage/repositories/automationRuleRepository';
import { normalizeTransactionAmount } from '../transactions/createTransaction';
import { normalizeMonthlyDays, resolveTimeOfDay } from './schedule';

export interface CreateAutomationRuleInput {
  bookId: string;
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
}

export async function createAutomationRule(
  db: AssetTrackerDb,
  input: CreateAutomationRuleInput
): Promise<AutomationRule> {
  const categoryRepository = new CategoryRepository(db);
  const ruleRepository = new AutomationRuleRepository(db);
  const [categories, rules] = await Promise.all([
    categoryRepository.listByBook(input.bookId),
    ruleRepository.listByBook(input.bookId)
  ]);
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

  if (!normalizedName) {
    throw new Error('Automation rule name is required');
  }

  if (rules.some((rule) => rule.deletedAt === null && rule.name === normalizedName)) {
    throw new Error('Automation rule already exists');
  }

  const now = new Date().toISOString();
  const rule = automationRuleSchema.parse({
    id: `rule_${crypto.randomUUID()}`,
    bookId: input.bookId,
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
    lastGeneratedAt: null,
    isActive: true,
    ...createMetadata(now)
  });

  await ruleRepository.put(rule);

  return rule;
}
