import { markDeleted } from '../../shared/utils/entityMetadata';
import { AssetTrackerDb } from '../../storage/db';
import { TransactionTemplateRepository } from '../../storage/repositories/transactionTemplateRepository';

export interface DeleteTransactionTemplateInput {
  bookId: string;
  templateId: string;
}

export async function deleteTransactionTemplate(
  db: AssetTrackerDb,
  input: DeleteTransactionTemplateInput
): Promise<void> {
  const repository = new TransactionTemplateRepository(db);
  const template = await repository.get(input.templateId);

  if (!template || template.bookId !== input.bookId || template.deletedAt !== null) {
    throw new Error('Template does not exist');
  }

  await repository.put({
    ...template,
    ...markDeleted(template)
  });
}
