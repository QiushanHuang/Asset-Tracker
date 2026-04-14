import type { Book } from '../../shared/types/entities';
import { listCategoryTree } from '../../domain/categories/listCategoryTree';
import { listExchangeRateHistoryForBook } from '../../domain/settings/listExchangeRateHistoryForBook';
import { updateBookBaseCurrency } from '../../domain/settings/updateBookBaseCurrency';
import { upsertExchangeRate } from '../../domain/settings/upsertExchangeRate';
import { formatDateForDateInput } from '../../shared/utils/datetimeLocal';
import { escapeHtml } from '../../shared/utils/escapeHtml';
import { AssetTrackerDb } from '../../storage/db';

interface SettingsPanelContext {
  db: AssetTrackerDb;
  book: Book;
  target: HTMLElement;
  onChange?: () => Promise<void>;
  onStatus?: (message: string) => void;
}

export async function renderSettingsPanel({
  db,
  book,
  target,
  onChange,
  onStatus
}: SettingsPanelContext): Promise<void> {
  const [categories, exchangeRateHistory] = await Promise.all([
    listCategoryTree(db, book.id),
    listExchangeRateHistoryForBook(db, book.id)
  ]);
  const activeCurrencies = [...new Set(categories.map((category) => category.currency))]
    .filter((currency) => currency !== book.baseCurrency);
  const currencyOptions = [...new Set([...activeCurrencies, ...exchangeRateHistory.map((rate) => rate.currency), 'USD', 'SGD', 'MYR'])]
    .filter((currency) => currency !== book.baseCurrency)
    .sort();

  target.innerHTML = `
    <div class="section-grid settings-grid">
      <section class="card">
        <div class="card-header">
          <h3>基础设置</h3>
        </div>
        <form data-role="base-currency-form" class="stack-form">
          <div class="form-grid">
            <select name="baseCurrency">
              <option value="CNY" ${book.baseCurrency === 'CNY' ? 'selected' : ''}>CNY</option>
              <option value="SGD" ${book.baseCurrency === 'SGD' ? 'selected' : ''}>SGD</option>
              <option value="USD" ${book.baseCurrency === 'USD' ? 'selected' : ''}>USD</option>
              <option value="MYR" ${book.baseCurrency === 'MYR' ? 'selected' : ''}>MYR</option>
            </select>
          </div>
          <div class="action-row">
            <button type="submit" class="btn btn-primary">更新基准币种</button>
          </div>
        </form>
      </section>
      <section class="card">
        <div class="card-header">
          <h3>汇率设置</h3>
          <span class="tag">按日期生效</span>
        </div>
        <form data-role="exchange-rate-form" class="stack-form">
          <div class="form-grid three-columns">
            <label class="field-label">
              <span>币种</span>
              <select name="currency">
                ${currencyOptions.map((currency) => `<option value="${currency}">${currency}</option>`).join('')}
              </select>
            </label>
            <label class="field-label">
              <span>汇率</span>
              <input name="rate" type="number" step="0.0001" min="0.0001" placeholder="1 外币 = ? 基准币" required />
            </label>
            <label class="field-label">
              <span>生效日期</span>
              <input name="effectiveFrom" type="date" value="${formatDateForDateInput(new Date())}" required />
            </label>
          </div>
          <p class="panel__empty">同一币种会按最近的生效日期向后覆盖；未来日期默认沿用最近一次汇率。</p>
          <div class="action-row">
            <button type="submit" class="btn btn-primary">保存汇率</button>
          </div>
        </form>
        <div class="transactions-table">
          <table>
            <thead>
              <tr>
                <th>币种</th>
                <th>生效日期</th>
                <th>汇率</th>
                <th>操作</th>
              </tr>
            </thead>
            <tbody data-role="exchange-rate-list">
              ${
                exchangeRateHistory.length === 0
                  ? '<tr><td colspan="4" class="panel__empty">暂无汇率，外币将不会计入总览。</td></tr>'
                  : exchangeRateHistory
                      .map(
                        (rate) => `
                          <tr>
                            <td>${escapeHtml(rate.currency)}</td>
                            <td>${escapeHtml(rate.effectiveFrom)}</td>
                            <td>1 ${escapeHtml(rate.currency)} = ${rate.rate} ${escapeHtml(book.baseCurrency)}</td>
                            <td>
                              <button
                                type="button"
                                class="btn btn-sm"
                                data-action="edit-rate"
                                data-currency="${rate.currency}"
                                data-rate="${rate.rate}"
                                data-effective-from="${rate.effectiveFrom}"
                              >编辑</button>
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
    </div>
  `;

  target.querySelector<HTMLFormElement>('[data-role="base-currency-form"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const baseCurrency = (form.elements.namedItem('baseCurrency') as HTMLSelectElement).value as
      | 'CNY'
      | 'SGD'
      | 'USD'
      | 'MYR';

    try {
      await updateBookBaseCurrency(db, {
        bookId: book.id,
        baseCurrency
      });
      onStatus?.('基准币种已更新');
      await onChange?.();
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : '更新基准币种失败');
    }
  });

  const exchangeRateForm = target.querySelector<HTMLFormElement>('[data-role="exchange-rate-form"]');

  exchangeRateForm?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const currency = (form.elements.namedItem('currency') as HTMLSelectElement).value as
      | 'CNY'
      | 'SGD'
      | 'USD'
      | 'MYR';
    const rate = Number((form.elements.namedItem('rate') as HTMLInputElement).value);
    const effectiveFrom = (form.elements.namedItem('effectiveFrom') as HTMLInputElement).value;

    try {
      await upsertExchangeRate(db, {
        bookId: book.id,
        currency,
        baseCurrency: book.baseCurrency,
        rate,
        effectiveFrom
      });
      onStatus?.('汇率已保存');
      form.reset();
      (form.elements.namedItem('effectiveFrom') as HTMLInputElement).value = formatDateForDateInput(new Date());
      await onChange?.();
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : '保存汇率失败');
    }
  });

  target.querySelector('[data-role="exchange-rate-list"]')?.addEventListener('click', (event) => {
    const button = (event.target as HTMLElement).closest<HTMLButtonElement>('[data-action="edit-rate"]');

    if (!button || !exchangeRateForm) {
      return;
    }

    (exchangeRateForm.elements.namedItem('currency') as HTMLSelectElement).value =
      button.dataset.currency ?? '';
    (exchangeRateForm.elements.namedItem('rate') as HTMLInputElement).value = button.dataset.rate ?? '';
    (exchangeRateForm.elements.namedItem('effectiveFrom') as HTMLInputElement).value =
      button.dataset.effectiveFrom ?? formatDateForDateInput(new Date());
  });
}
