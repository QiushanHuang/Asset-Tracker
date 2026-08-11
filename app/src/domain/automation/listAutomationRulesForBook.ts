import { AssetTrackerDb } from '../../storage/db';
import { AutomationRuleRepository } from '../../storage/repositories/automationRuleRepository';
import { CategoryRepository } from '../../storage/repositories/categoryRepository';

export interface AutomationRuleListItem {
  id: string;
  name: string;
  categoryId: string;
  categoryName: string;
  amount: number;
  currency: 'CNY' | 'SGD' | 'USD' | 'MYR';
  direction: 'income' | 'expense' | 'transfer' | 'adjustment';
  purpose: string;
  description: string;
  frequency: 'daily' | 'weekly' | 'monthly' | 'yearly';
  interval: number;
  startDate: string;
  endDate: string | null;
  monthlyDays: number[];
  includeLastDayOfMonth: boolean;
  timeOfDay: string;
  lastGeneratedAt: string | null;
  isActive: boolean;
}

export async function listAutomationRulesForBook(
  db: AssetTrackerDb,
  bookId: string
): Promise<AutomationRuleListItem[]> {
  const ruleRepository = new AutomationRuleRepository(db);
  const categoryRepository = new CategoryRepository(db);
  const [rules, categories] = await Promise.all([
    ruleRepository.listByBook(bookId),
    categoryRepository.listByBook(bookId)
  ]);
  const categoryNameById = new Map(categories.map((category) => [category.id, category.name]));

  return rules
    .filter((rule) => rule.deletedAt === null)
    .sort((left, right) => left.name.localeCompare(right.name))
    .map((rule) => ({
      id: rule.id,
      name: rule.name,
      categoryId: rule.categoryId,
      categoryName: categoryNameById.get(rule.categoryId) ?? '未知分类',
      amount: rule.amount,
      currency: rule.currency,
      direction: rule.direction,
      purpose: rule.purpose,
      description: rule.description,
      frequency: rule.frequency,
      interval: rule.interval,
      startDate: rule.startDate,
      endDate: rule.endDate,
      monthlyDays: rule.monthlyDays,
      includeLastDayOfMonth: rule.includeLastDayOfMonth,
      timeOfDay: rule.timeOfDay,
      lastGeneratedAt: rule.lastGeneratedAt,
      isActive: rule.isActive
    }));
}
