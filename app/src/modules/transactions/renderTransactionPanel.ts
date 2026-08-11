import type { Book } from '../../shared/types/entities';
import { listCategoryTree } from '../../domain/categories/listCategoryTree';
import { listTransactionTemplatesForBook } from '../../domain/templates/listTransactionTemplatesForBook';
import { createTransaction } from '../../domain/transactions/createTransaction';
import { deleteTransaction } from '../../domain/transactions/deleteTransaction';
import {
  listTransactionsForBook,
  type ListTransactionsForBookOptions
} from '../../domain/transactions/listTransactionsForBook';
import { updateTransaction } from '../../domain/transactions/updateTransaction';
import {
  formatDateForDateInput,
  formatIsoForDatetimeLocal,
  parseDatetimeLocalToIso
} from '../../shared/utils/datetimeLocal';
import { escapeHtml } from '../../shared/utils/escapeHtml';
import { formatMinorUnits } from '../../shared/utils/money';
import { AssetTrackerDb } from '../../storage/db';

interface TransactionPanelContext {
  db: AssetTrackerDb;
  book: Book;
  target: HTMLElement;
  onChange?: () => Promise<void>;
  onStatus?: (message: string) => void;
}

function editableAmount(
  amount: number,
  direction: 'income' | 'expense' | 'transfer' | 'adjustment'
): string {
  if (direction === 'adjustment' || direction === 'transfer') {
    return (amount / 100).toFixed(2);
  }

  return (Math.abs(amount) / 100).toFixed(2);
}

function readFilterState(target: HTMLElement): ListTransactionsForBookOptions {
  try {
    return target.dataset.transactionFilters ? JSON.parse(target.dataset.transactionFilters) : {};
  } catch {
    return {};
  }
}

export async function renderTransactionPanel({
  db,
  book,
  target,
  onChange,
  onStatus
}: TransactionPanelContext): Promise<void> {
  const currentFilters = readFilterState(target);
  const [categories, allTransactions, transactions, templates] = await Promise.all([
    listCategoryTree(db, book.id),
    listTransactionsForBook(db, book.id),
    listTransactionsForBook(db, book.id, currentFilters),
    listTransactionTemplatesForBook(db, book.id)
  ]);
  const leafCategories = categories.filter((item) => item.kind !== 'group');
  const categoryById = new Map(leafCategories.map((item) => [item.id, item]));
  const transactionById = new Map(allTransactions.map((item) => [item.id, item]));
  const templateById = new Map(templates.map((item) => [item.id, item]));
  const availableYears = [...new Set(allTransactions.map((item) => formatDateForDateInput(item.occurredAt).slice(0, 4)))].sort(
    (left, right) => right.localeCompare(left)
  );

  target.dataset.panel = 'transactions';
  target.innerHTML = `
    <section class="card">
      <div class="card-header">
        <h3>账单记录</h3>
      </div>
      <form data-role="transaction-form" class="stack-form">
        <input name="editingId" type="hidden" />
        <div class="form-grid three-columns">
          <select name="templateId">
            <option value="">选择模板（可选）</option>
            ${templates
              .map((template) => `<option value="${template.id}">${escapeHtml(template.name)}</option>`)
              .join('')}
          </select>
          <select name="categoryId" required>
            <option value="">选择分类</option>
            ${leafCategories
              .map(
                (item) =>
                  `<option value="${item.id}">${escapeHtml('— '.repeat(item.depth) + item.name)}</option>`
              )
              .join('')}
          </select>
          <select name="direction">
            <option value="income">收入</option>
            <option value="expense">支出</option>
            <option value="adjustment">调整</option>
          </select>
          <input name="amount" type="number" step="0.01" placeholder="金额" required />
          <input name="purpose" placeholder="用途" required />
          <input name="description" placeholder="备注" />
          <input name="occurredAt" type="datetime-local" required value="${formatIsoForDatetimeLocal(new Date().toISOString())}" />
        </div>
        <div class="action-row">
          <button type="submit" class="btn btn-primary" data-role="transaction-submit">记录账单</button>
          <button type="button" class="btn btn-secondary" data-role="transaction-cancel" hidden>取消编辑</button>
        </div>
      </form>
      <form data-role="transaction-filter-form" class="stack-form transaction-filter-form">
        <div class="form-grid filter-grid">
          <label class="field-label">
            <span>年份</span>
            <select name="year">
              <option value="">全部年份</option>
              ${availableYears
                .map((year) => `<option value="${year}" ${currentFilters.year === year ? 'selected' : ''}>${year}</option>`)
                .join('')}
            </select>
          </label>
          <label class="field-label">
            <span>月份</span>
            <select name="month">
              <option value="">全部月份</option>
              ${Array.from({ length: 12 }, (_, index) => String(index + 1).padStart(2, '0'))
                .map(
                  (month) =>
                    `<option value="${month}" ${currentFilters.month === month ? 'selected' : ''}>${month}</option>`
                )
                .join('')}
            </select>
          </label>
          <label class="field-label">
            <span>日期</span>
            <input name="date" type="date" value="${escapeHtml(currentFilters.date ?? '')}" />
          </label>
          <label class="field-label">
            <span>分类</span>
            <select name="categoryId">
              <option value="">全部分类</option>
              ${leafCategories
                .map(
                  (item) =>
                    `<option value="${item.id}" ${currentFilters.categoryId === item.id ? 'selected' : ''}>${escapeHtml('— '.repeat(item.depth) + item.name)}</option>`
                )
                .join('')}
            </select>
          </label>
          <label class="field-label">
            <span>用途</span>
            <input name="purpose" placeholder="模糊搜索用途" value="${escapeHtml(currentFilters.purpose ?? '')}" />
          </label>
          <label class="field-label">
            <span>方向</span>
            <select name="direction">
              <option value="all" ${!currentFilters.direction || currentFilters.direction === 'all' ? 'selected' : ''}>全部</option>
              <option value="income" ${currentFilters.direction === 'income' ? 'selected' : ''}>收入</option>
              <option value="expense" ${currentFilters.direction === 'expense' ? 'selected' : ''}>支出</option>
              <option value="transfer" ${currentFilters.direction === 'transfer' ? 'selected' : ''}>转账</option>
              <option value="adjustment" ${currentFilters.direction === 'adjustment' ? 'selected' : ''}>调整</option>
            </select>
          </label>
          <label class="field-label">
            <span>排序</span>
            <select name="sortBy">
              <option value="occurredAt-desc" ${!currentFilters.sortBy || currentFilters.sortBy === 'occurredAt-desc' ? 'selected' : ''}>时间从新到旧</option>
              <option value="occurredAt-asc" ${currentFilters.sortBy === 'occurredAt-asc' ? 'selected' : ''}>时间从旧到新</option>
              <option value="amount-desc" ${currentFilters.sortBy === 'amount-desc' ? 'selected' : ''}>金额从大到小</option>
              <option value="amount-asc" ${currentFilters.sortBy === 'amount-asc' ? 'selected' : ''}>金额从小到大</option>
            </select>
          </label>
        </div>
        <div class="action-row">
          <button type="submit" class="btn btn-secondary">应用筛选</button>
          <button type="button" class="btn btn-secondary" data-role="transaction-filter-reset">清空筛选</button>
        </div>
      </form>
      <div class="transactions-table">
        <table>
          <thead>
            <tr>
              <th>时间</th>
              <th>分类</th>
              <th>用途</th>
              <th>备注</th>
              <th>金额</th>
              <th>操作</th>
            </tr>
          </thead>
          <tbody data-role="transaction-list">
            ${
              transactions.length === 0
                ? '<tr><td colspan="6" class="panel__empty">当前筛选下没有账单记录。</td></tr>'
                : transactions
                    .map(
                      (item) => `
                        <tr>
                          <td>${escapeHtml(formatIsoForDatetimeLocal(item.occurredAt).replace('T', ' '))}</td>
                          <td>${escapeHtml(item.categoryName)}</td>
                          <td>${escapeHtml(item.purpose)}</td>
                          <td>${escapeHtml(item.description || '无备注')}</td>
                          <td class="${item.amount >= 0 ? 'positive' : 'negative'}">${formatMinorUnits(item.amount)}</td>
                          <td>
                            <div class="template-actions">
                              <button type="button" class="btn btn-sm" data-action="edit" data-transaction-id="${item.id}">编辑</button>
                              <button type="button" class="btn btn-sm btn-danger" data-action="delete" data-transaction-id="${item.id}">删除</button>
                            </div>
                          </td>
                        </tr>
                      `
                    )
                    .join('')
            }
          </tbody>
        </table>
      </div>
    </section>
  `;

  const form = target.querySelector<HTMLFormElement>('[data-role="transaction-form"]');
  const cancelButton = target.querySelector<HTMLButtonElement>('[data-role="transaction-cancel"]');
  const submitButton = target.querySelector<HTMLButtonElement>('[data-role="transaction-submit"]');

  const resetForm = (): void => {
    form?.reset();

    if (!form) {
      return;
    }

    (form.elements.namedItem('editingId') as HTMLInputElement).value = '';
    (form.elements.namedItem('occurredAt') as HTMLInputElement).value = formatIsoForDatetimeLocal(
      new Date().toISOString()
    );

    if (submitButton) {
      submitButton.textContent = '记录账单';
    }

    if (cancelButton) {
      cancelButton.hidden = true;
    }
  };

  cancelButton?.addEventListener('click', () => {
    resetForm();
  });

  const templateSelect = form?.elements.namedItem('templateId') as HTMLSelectElement | null;

  templateSelect?.addEventListener('change', async () => {
    if (!form) {
      return;
    }

    const templateId = templateSelect.value;
    const template = templateId ? templateById.get(templateId) : undefined;

    if (!template) {
      return;
    }

    (form.elements.namedItem('categoryId') as HTMLSelectElement).value = template.categoryId;
    (form.elements.namedItem('direction') as HTMLSelectElement).value = template.direction;
    (form.elements.namedItem('amount') as HTMLInputElement).value = editableAmount(
      template.amount,
      template.direction
    );
    (form.elements.namedItem('purpose') as HTMLInputElement).value = template.purpose;
    (form.elements.namedItem('description') as HTMLInputElement).value = template.description;
  });

  form?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const transactionForm = event.currentTarget as HTMLFormElement;
    const formData = new FormData(transactionForm);
    const occurredAtValue = String(formData.get('occurredAt') ?? '');
    const categoryId = String(formData.get('categoryId') ?? '');
    const category = categoryById.get(categoryId);
    const editingId = String(formData.get('editingId') ?? '');
    const templateId = String(formData.get('templateId') ?? '');

    if (!category) {
      onStatus?.('Category does not exist');
      return;
    }

    if (submitButton) {
      submitButton.disabled = true;
    }

    try {
      if (editingId) {
        await updateTransaction(db, {
          bookId: book.id,
          transactionId: editingId,
          categoryId,
          amount: Number(formData.get('amount') ?? 0),
          currency: category.currency,
          direction: String(formData.get('direction') ?? 'expense') as
            | 'income'
            | 'expense'
            | 'transfer'
            | 'adjustment',
          purpose: String(formData.get('purpose') ?? ''),
          description: String(formData.get('description') ?? ''),
          occurredAt: parseDatetimeLocalToIso(occurredAtValue)
        });
        onStatus?.('账单已更新');
      } else {
        await createTransaction(db, {
          bookId: book.id,
          categoryId,
          amount: Number(formData.get('amount') ?? 0),
          currency: category.currency,
          direction: String(formData.get('direction') ?? 'expense') as
            | 'income'
            | 'expense'
            | 'transfer'
            | 'adjustment',
          purpose: String(formData.get('purpose') ?? ''),
          description: String(formData.get('description') ?? ''),
          occurredAt: parseDatetimeLocalToIso(occurredAtValue)
        });
        onStatus?.(templateId ? '已按模板预填并记录账单' : '账单已记录');
      }

      resetForm();

      if (onChange) {
        await onChange();
      } else {
        await renderTransactionPanel({ db, book, target, onChange, onStatus });
      }
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : '账单操作失败');
    } finally {
      if (submitButton) {
        submitButton.disabled = false;
      }
    }
  });

  target.querySelector('[data-role="transaction-list"]')?.addEventListener('click', async (event) => {
    const actionButton = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action]');

    if (!actionButton || !form) {
      return;
    }

    const transactionId = actionButton.dataset.transactionId;

    if (!transactionId) {
      return;
    }

    if (actionButton.dataset.action === 'edit') {
      const transaction = transactionById.get(transactionId);

      if (!transaction) {
        return;
      }

      (form.elements.namedItem('editingId') as HTMLInputElement).value = transaction.id;
      (form.elements.namedItem('templateId') as HTMLSelectElement).value = '';
      (form.elements.namedItem('categoryId') as HTMLSelectElement).value = transaction.categoryId;
      (form.elements.namedItem('direction') as HTMLSelectElement).value = transaction.direction;
      (form.elements.namedItem('amount') as HTMLInputElement).value = editableAmount(
        transaction.amount,
        transaction.direction
      );
      (form.elements.namedItem('purpose') as HTMLInputElement).value = transaction.purpose;
      (form.elements.namedItem('description') as HTMLInputElement).value = transaction.description;
      (form.elements.namedItem('occurredAt') as HTMLInputElement).value = formatIsoForDatetimeLocal(
        transaction.occurredAt
      );

      if (submitButton) {
        submitButton.textContent = '保存账单';
      }

      if (cancelButton) {
        cancelButton.hidden = false;
      }

      return;
    }

    if (actionButton.dataset.action === 'delete') {
      try {
        await deleteTransaction(db, {
          bookId: book.id,
          transactionId
        });
        onStatus?.('账单已删除');

        if (onChange) {
          await onChange();
        } else {
          await renderTransactionPanel({ db, book, target, onChange, onStatus });
        }
      } catch (error) {
        onStatus?.(error instanceof Error ? error.message : '删除账单失败');
      }
    }
  });

  const filterForm = target.querySelector<HTMLFormElement>('[data-role="transaction-filter-form"]');

  filterForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const transactionFilterForm = event.currentTarget as HTMLFormElement;
    const formData = new FormData(transactionFilterForm);
    const nextFilters: ListTransactionsForBookOptions = {
      year: String(formData.get('year') ?? ''),
      month: String(formData.get('month') ?? ''),
      date: String(formData.get('date') ?? ''),
      categoryId: String(formData.get('categoryId') ?? ''),
      purpose: String(formData.get('purpose') ?? ''),
      direction: String(formData.get('direction') ?? 'all') as ListTransactionsForBookOptions['direction'],
      sortBy: String(formData.get('sortBy') ?? 'occurredAt-desc') as ListTransactionsForBookOptions['sortBy']
    };

    Object.keys(nextFilters).forEach((key) => {
      const value = nextFilters[key as keyof ListTransactionsForBookOptions];

      if (value === '') {
        delete nextFilters[key as keyof ListTransactionsForBookOptions];
      }
    });

    target.dataset.transactionFilters = JSON.stringify(nextFilters);
    await renderTransactionPanel({ db, book, target, onChange, onStatus });
  });

  target.querySelector<HTMLButtonElement>('[data-role="transaction-filter-reset"]')?.addEventListener('click', async () => {
    target.dataset.transactionFilters = JSON.stringify({});
    await renderTransactionPanel({ db, book, target, onChange, onStatus });
  });
}
