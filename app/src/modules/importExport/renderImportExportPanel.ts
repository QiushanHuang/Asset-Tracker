import type { Book } from '../../shared/types/entities';
import { exportBookSnapshot } from '../../domain/importExport/exportBookSnapshot';
import { importBookSnapshot } from '../../domain/importExport/importBookSnapshot';
import { listTransactionsForBook } from '../../domain/transactions/listTransactionsForBook';
import { downloadTextFile } from '../../shared/utils/downloadTextFile';
import { AssetTrackerDb } from '../../storage/db';
import { importLegacyAssetTracker } from '../../storage/migrations/importLegacyAssetTracker';

interface ImportExportPanelContext {
  db: AssetTrackerDb;
  book: Book;
  target: HTMLElement;
  onChange?: () => Promise<void>;
  onStatus?: (message: string) => void;
}

function escapeCsvField(value: string): string {
  return value.replaceAll('"', '""');
}

function buildTransactionCsv(rows: Awaited<ReturnType<typeof listTransactionsForBook>>): string {
  const header = ['occurredAt', 'categoryName', 'purpose', 'description', 'amount', 'currency'];
  const body = rows.map((row) =>
    [
      row.occurredAt,
      escapeCsvField(row.categoryName),
      escapeCsvField(row.purpose),
      escapeCsvField(row.description),
      String(row.amount / 100),
      row.currency
    ]
      .map((value) => `"${value}"`)
      .join(',')
  );

  return [header.join(','), ...body].join('\n');
}

export async function renderImportExportPanel({
  db,
  book,
  target,
  onChange,
  onStatus
}: ImportExportPanelContext): Promise<void> {
  target.innerHTML = `
    <div class="section-grid">
      <section class="card">
        <div class="card-header">
          <h3>导出数据</h3>
        </div>
        <div class="action-row">
          <button type="button" class="btn btn-primary" data-action="export-json">导出快照</button>
          <button type="button" class="btn btn-secondary" data-action="export-csv">导出账单 CSV</button>
        </div>
      </section>
      <section class="card">
        <div class="card-header">
          <h3>导入数据</h3>
        </div>
        <form data-role="import-form" class="stack-form">
          <input name="file" type="file" accept="application/json" required />
          <div class="action-row">
            <button type="submit" class="btn btn-primary">导入快照</button>
          </div>
        </form>
      </section>
    </div>
  `;

  const handleExport = async (action: 'export-json' | 'export-csv'): Promise<void> => {
    try {
      if (action === 'export-json') {
        const snapshot = await exportBookSnapshot(db, book.id);
        downloadTextFile(`asset-tracker-${book.id}-snapshot.json`, snapshot, 'application/json');
        onStatus?.('快照已导出');
        return;
      }

      if (action === 'export-csv') {
        const transactions = await listTransactionsForBook(db, book.id);
        downloadTextFile(
          `asset-tracker-${book.id}-transactions.csv`,
          buildTransactionCsv(transactions),
          'text/csv;charset=utf-8'
        );
        onStatus?.('CSV 已导出');
      }
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : '导出失败');
    }
  };

  target.querySelector<HTMLButtonElement>('[data-action="export-json"]')?.addEventListener('click', () => {
    void handleExport('export-json');
  });

  target.querySelector<HTMLButtonElement>('[data-action="export-csv"]')?.addEventListener('click', () => {
    void handleExport('export-csv');
  });

  target.querySelector<HTMLFormElement>('[data-role="import-form"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const fileInput = form.elements.namedItem('file') as HTMLInputElement;
    const file = fileInput.files?.[0];

    if (!file) {
      onStatus?.('请选择一个快照文件');
      return;
    }

    try {
      const payload = await file.text();
      try {
        await importBookSnapshot(db, {
          bookId: book.id,
          payload
        });
        onStatus?.('快照已导入');
      } catch (snapshotError) {
        await importLegacyAssetTracker(db, {
          bookId: book.id,
          payload: JSON.parse(payload)
        });
        onStatus?.('旧版 JSON 数据已导入');
      }
      form.reset();
      await onChange?.();
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : '导入快照失败');
    }
  });
}
