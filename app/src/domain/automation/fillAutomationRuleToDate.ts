import type { Transaction } from '../../shared/types/entities';
import { automationRuleSchema } from '../../shared/validation/schemas';
import { bumpMetadata } from '../../shared/utils/entityMetadata';
import { AssetTrackerDb } from '../../storage/db';
import { AutomationRuleRepository } from '../../storage/repositories/automationRuleRepository';
import { TransactionRepository } from '../../storage/repositories/transactionRepository';
import { createTransaction } from '../transactions/createTransaction';
import { listAutomationOccurrences } from './schedule';

export interface FillAutomationRuleToDateInput {
  bookId: string;
  ruleId: string;
  throughDate: string;
}

export async function fillAutomationRuleToDate(
  db: AssetTrackerDb,
  input: FillAutomationRuleToDateInput
): Promise<Transaction[]> {
  const ruleRepository = new AutomationRuleRepository(db);
  const transactionRepository = new TransactionRepository(db);
  const [rule, transactions] = await Promise.all([
    ruleRepository.get(input.ruleId),
    transactionRepository.listByBook(input.bookId)
  ]);

  if (!rule || rule.bookId !== input.bookId || rule.deletedAt !== null) {
    throw new Error('Automation rule does not exist');
  }

  if (!rule.isActive) {
    return [];
  }

  const createdTransactions: Transaction[] = [];
  const occurrences = listAutomationOccurrences(rule, input.throughDate);

  for (const occurrence of occurrences) {
    const alreadyExists = transactions.some(
      (transaction) =>
        transaction.deletedAt === null &&
        transaction.automationRuleId === rule.id &&
        transaction.automationOccurrenceDate === occurrence.date
    );

    if (!alreadyExists) {
      createdTransactions.push(
        await createTransaction(db, {
          bookId: rule.bookId,
          categoryId: rule.categoryId,
          amount: rule.amount / 100,
          currency: rule.currency,
          direction: rule.direction,
          purpose: rule.purpose,
          description: `[rule:${rule.id}] ${rule.description}`.trim(),
          occurredAt: occurrence.occurredAt,
          automationRuleId: rule.id,
          automationOccurrenceDate: occurrence.date
        })
      );
    }
  }

  if (createdTransactions.length > 0) {
    const now = new Date().toISOString();
    const updatedRule = automationRuleSchema.parse({
      ...rule,
      lastGeneratedAt: now,
      ...bumpMetadata(rule, now)
    });

    await ruleRepository.put(updatedRule);
  }

  return createdTransactions;
}
