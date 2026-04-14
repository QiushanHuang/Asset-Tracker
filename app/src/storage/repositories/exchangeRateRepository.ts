import type { ExchangeRate } from '../../shared/types/entities';
import type { OperationLogEntry } from '../db';
import { AssetTrackerDb } from '../db';

function buildPutOperation(exchangeRate: ExchangeRate): OperationLogEntry {
  return {
    id: `op_${exchangeRate.id}_${exchangeRate.revision}`,
    bookId: exchangeRate.bookId,
    entityType: 'exchangeRate',
    entityId: exchangeRate.id,
    operationType: 'put',
    payload: JSON.stringify(exchangeRate),
    deviceId: exchangeRate.deviceId,
    createdAt: exchangeRate.updatedAt
  };
}

export class ExchangeRateRepository {
  constructor(private readonly db: AssetTrackerDb) {}

  listByBook(bookId: string): Promise<ExchangeRate[]> {
    return this.db.exchangeRates.where('bookId').equals(bookId).sortBy('effectiveFrom');
  }

  get(rateId: string): Promise<ExchangeRate | undefined> {
    return this.db.exchangeRates.get(rateId);
  }

  async put(exchangeRate: ExchangeRate): Promise<void> {
    await this.putMany([exchangeRate]);
  }

  async putMany(exchangeRates: ExchangeRate[]): Promise<void> {
    await this.db.transaction('rw', this.db.exchangeRates, this.db.operations, async () => {
      for (const exchangeRate of exchangeRates) {
        const existing = await this.db.exchangeRates.get(exchangeRate.id);

        if (existing && exchangeRate.revision <= existing.revision) {
          throw new Error('Revision conflict');
        }
      }

      await this.db.exchangeRates.bulkPut(exchangeRates);
      await this.db.operations.bulkPut(exchangeRates.map((exchangeRate) => buildPutOperation(exchangeRate)));
    });
  }
}
