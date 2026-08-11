import type { Book } from '../../shared/types/entities';
import {
  calculateDashboardSnapshot,
  type DashboardTrendPeriod
} from '../../domain/dashboard/calculateDashboardSnapshot';
import { updateBookMemo } from '../../domain/settings/updateBookMemo';
import { escapeHtml } from '../../shared/utils/escapeHtml';
import { formatMinorUnits, formatMinorUnitsAbsolute } from '../../shared/utils/money';
import { AssetTrackerDb } from '../../storage/db';

interface SummaryPanelContext {
  db: AssetTrackerDb;
  book: Book;
  target: HTMLElement;
  onChange?: () => Promise<void>;
  onStatus?: (message: string) => void;
}

interface PositionedTick {
  label: string;
  position: string;
  edge: 'start' | 'middle' | 'end' | 'center';
}

interface AxisGuide {
  value: number;
  y: number;
}

function metricClassName(amount: number, kind: 'asset' | 'debt' | 'net'): string {
  if (kind === 'debt') {
    return 'negative';
  }

  if (kind === 'asset') {
    return 'summary-value--asset';
  }

  return amount >= 0 ? 'positive' : 'negative';
}

function buildAxisTicks(labels: string[], maxTicks = 6): PositionedTick[] {
  if (labels.length === 0) {
    return [];
  }

  const buildPosition = (
    index: number,
    length: number
  ): { position: string; edge: 'start' | 'middle' | 'end' | 'center' } => {
    if (length === 1) {
      return { position: 'left:50%', edge: 'center' };
    }

    if (index === 0) {
      return { position: 'left:0', edge: 'start' };
    }

    if (index === length - 1) {
      return { position: 'right:0', edge: 'end' };
    }

    return {
      position: `left:${((index / (length - 1)) * 100).toFixed(2)}%`,
      edge: 'middle'
    };
  };

  if (labels.length <= maxTicks) {
    return labels.map((label, index) => ({
      label,
      ...buildPosition(index, labels.length)
    }));
  }

  const step = Math.ceil((labels.length - 1) / (maxTicks - 1));
  const items = labels
    .map((label, index) => ({ label, index }))
    .filter(({ index }) => index === 0 || index === labels.length - 1 || index % step === 0);

  return items.map(({ label, index }) => ({
    label,
    ...buildPosition(index, labels.length)
  }));
}

function buildAxisGuides(values: number[], height = 160, tickCount = 4): AxisGuide[] {
  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max === min ? Math.max(Math.abs(max), 1) : max - min;

  return Array.from({ length: tickCount }, (_, index) => {
    const ratio = tickCount === 1 ? 0.5 : index / (tickCount - 1);
    const value = max - range * ratio;

    return {
      value,
      y: 16 + ratio * (height - 32)
    };
  });
}

function buildTrendPath(values: number[], width = 520, height = 160): string {
  if (values.length === 0) {
    return '';
  }

  const max = Math.max(...values, 0);
  const min = Math.min(...values, 0);
  const range = max === min ? Math.max(Math.abs(max), 1) : max - min;

  return values
    .map((value, index) => {
      const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
      const y = 16 + (1 - (value - min) / range) * (height - 32);

      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
    })
    .join(' ');
}

function buildTrendArea(values: number[], width = 520, height = 160): string {
  if (values.length === 0) {
    return '';
  }

  const line = buildTrendPath(values, width, height);
  const lastX = values.length === 1 ? width / 2 : width;

  return `${line} L ${lastX.toFixed(2)} ${height - 16} L 0 ${height - 16} Z`;
}

function readSelectedPeriod(target: HTMLElement): DashboardTrendPeriod {
  const period = target.dataset.summaryPeriod;
  return period === 'week' || period === 'year' ? period : 'month';
}

export async function renderSummaryPanel({
  db,
  book,
  target,
  onChange,
  onStatus
}: SummaryPanelContext): Promise<void> {
  const selectedPeriod = readSelectedPeriod(target);
  const snapshot = await calculateDashboardSnapshot(db, book.id, new Date().toISOString(), selectedPeriod);
  const weekDelta = snapshot.currentSummary.netAmount - snapshot.previousWeekSummary.netAmount;
  const monthDelta = snapshot.currentSummary.netAmount - snapshot.previousMonthSummary.netAmount;
  const trendValues = snapshot.trend.map((item) => item.value);
  const axisTicks = buildAxisTicks(snapshot.trend.map((item) => item.label));
  const axisGuides = buildAxisGuides(trendValues);

  target.dataset.panel = 'summary';
  target.dataset.summaryPeriod = snapshot.selectedPeriod;
  target.innerHTML = `
    <section class="card asset-summary">
      <div class="card-header">
        <h3>资产总览</h3>
        <span class="tag">基准币种 ${book.baseCurrency}</span>
      </div>
      <div class="summary-grid">
        <article class="summary-item" data-summary-kind="net">
          <span class="label">净资产</span>
          <strong class="value ${metricClassName(snapshot.currentSummary.netAmount, 'net')}">${formatMinorUnits(snapshot.currentSummary.netAmount)}</strong>
        </article>
        <article class="summary-item" data-summary-kind="asset">
          <span class="label">资产</span>
          <strong class="value ${metricClassName(snapshot.currentSummary.assetAmount, 'asset')}">${formatMinorUnits(snapshot.currentSummary.assetAmount)}</strong>
        </article>
        <article class="summary-item" data-summary-kind="debt">
          <span class="label">负债</span>
          <strong class="value ${metricClassName(snapshot.currentSummary.debtAmount, 'debt')}">${formatMinorUnitsAbsolute(snapshot.currentSummary.debtAmount)}</strong>
        </article>
        <article class="summary-item" data-summary-kind="transactions">
          <span class="label">账单数</span>
          <strong class="value">${snapshot.currentSummary.transactionCount}</strong>
        </article>
      </div>
      ${
        snapshot.currentSummary.unresolvedCurrencies.length > 0
          ? `<p class="panel__empty">以下币种缺少汇率，暂未折算进总览：${snapshot.currentSummary.unresolvedCurrencies.join(', ')}</p>`
          : ''
      }
    </section>
    <div class="section-grid dashboard-detail-grid">
      <section class="card dashboard-span-5">
        <div class="card-header">
          <h3>总资产变化</h3>
          <span class="tag">${snapshot.selectedPeriodLabel}</span>
        </div>
        <div class="summary-grid compact-summary-grid">
          <article class="summary-item">
            <span class="label">${snapshot.selectedPeriodLabel}变动</span>
            <strong class="value ${metricClassName(snapshot.selectedPeriodDelta, 'net')}">${formatMinorUnits(snapshot.selectedPeriodDelta)}</strong>
          </article>
          <article class="summary-item">
            <span class="label">近 7 日变动</span>
            <strong class="value ${metricClassName(weekDelta, 'net')}">${formatMinorUnits(weekDelta)}</strong>
          </article>
          <article class="summary-item">
            <span class="label">近 30 日变动</span>
            <strong class="value ${metricClassName(monthDelta, 'net')}">${formatMinorUnits(monthDelta)}</strong>
          </article>
          <article class="summary-item">
            <span class="label">资产 / 负债比</span>
            <strong class="value">${snapshot.currentSummary.debtAmount === 0 ? '∞' : (snapshot.currentSummary.assetAmount / snapshot.currentSummary.debtAmount).toFixed(2)}</strong>
          </article>
        </div>
      </section>
      <section class="card dashboard-span-7">
        <div class="card-header">
          <h3>图表概况</h3>
          <div class="card-header-actions">
            <select data-role="dashboard-period" class="dashboard-period-select">
              <option value="week" ${snapshot.selectedPeriod === 'week' ? 'selected' : ''}>周</option>
              <option value="month" ${snapshot.selectedPeriod === 'month' ? 'selected' : ''}>月</option>
              <option value="year" ${snapshot.selectedPeriod === 'year' ? 'selected' : ''}>年</option>
            </select>
            <span class="tag">金额轴 + 网格</span>
          </div>
        </div>
        <div class="dashboard-overview-chart dashboard-overview-chart--framed">
          <div class="dashboard-y-axis">
            ${axisGuides
              .map(
                (guide) =>
                  `<span data-role="dashboard-y-axis-label">${formatMinorUnits(Math.round(guide.value))}</span>`
              )
              .join('')}
          </div>
          <div class="dashboard-chart-canvas">
            <svg viewBox="0 0 520 160" preserveAspectRatio="none" role="img" aria-label="概览趋势图">
              ${axisGuides
                .map(
                  (guide) =>
                    `<line data-role="dashboard-grid-line" class="chart-grid-line" x1="0" x2="520" y1="${guide.y.toFixed(2)}" y2="${guide.y.toFixed(2)}"></line>`
                )
                .join('')}
              <path class="trend-area" d="${buildTrendArea(trendValues)}"></path>
              <path class="trend-line" d="${buildTrendPath(trendValues)}"></path>
            </svg>
            <div class="trend-axis trend-axis--positioned dashboard-axis dashboard-axis--positioned">
              ${axisTicks
                .map(
                  (item) =>
                    `<span data-edge="${item.edge}" style="${item.position}">${escapeHtml(item.label)}</span>`
                )
                .join('')}
            </div>
          </div>
        </div>
        <div class="dashboard-lists">
          <div>
            <strong>主要资产</strong>
            <div class="dashboard-chip-list">
              ${
                snapshot.topAssets.length === 0
                  ? '<span class="panel__empty">暂无</span>'
                  : snapshot.topAssets
                      .map((item) => `<span class="dashboard-chip summary-chip--asset">${escapeHtml(item.name)} · ${formatMinorUnits(item.amount)}</span>`)
                      .join('')
              }
            </div>
          </div>
          <div>
            <strong>主要负债</strong>
            <div class="dashboard-chip-list">
              ${
                snapshot.topDebts.length === 0
                  ? '<span class="panel__empty">暂无</span>'
                  : snapshot.topDebts
                      .map((item) => `<span class="dashboard-chip negative">${escapeHtml(item.name)} · ${formatMinorUnitsAbsolute(item.amount)}</span>`)
                      .join('')
              }
            </div>
          </div>
        </div>
      </section>
      <section class="card dashboard-span-7">
        <div class="card-header">
          <h3>最近账单</h3>
          <span class="tag">快速查看</span>
        </div>
        <div class="dashboard-transaction-list">
          ${
            snapshot.recentTransactions.length === 0
              ? '<p class="panel__empty">还没有账单，录入后会在这里快速显示。</p>'
              : snapshot.recentTransactions
                  .map(
                    (item) => `
                      <article class="dashboard-transaction-item">
                        <div>
                          <strong>${escapeHtml(item.purpose)}</strong>
                          <div class="dashboard-transaction-meta">${escapeHtml(item.categoryName)} · ${escapeHtml(item.occurredAt.slice(0, 16).replace('T', ' '))}</div>
                        </div>
                        <strong class="${item.amount >= 0 ? 'positive' : 'negative'}">${formatMinorUnits(item.amount)}</strong>
                      </article>
                    `
                  )
                  .join('')
          }
        </div>
      </section>
      <section class="card dashboard-span-5">
        <div class="card-header">
          <h3>概览备忘录</h3>
          <span class="tag">本地保存</span>
        </div>
        <form data-role="summary-memo-form" class="stack-form summary-memo-form">
          <textarea name="memo" rows="8" placeholder="记录提醒、对账备注、下一步计划...">${escapeHtml(snapshot.memo)}</textarea>
          <div class="action-row">
            <button type="submit" class="btn btn-primary">保存备忘录</button>
          </div>
        </form>
      </section>
      <section class="card dashboard-span-12">
        <div class="card-header">
          <h3>币种汇总</h3>
        </div>
        <div class="currency-breakdown">
          ${snapshot.currentSummary.currencyBreakdown
            .map(
              (item) => `
                <article class="currency-item">
                  <div class="currency-name">${item.currency}</div>
                  <div class="currency-amount">原币净额 ${formatMinorUnits(item.netAmount)}</div>
                  <div class="currency-equivalent">
                    ${
                      item.convertedNetAmount === null
                        ? '缺少汇率'
                        : `折算 ${book.baseCurrency} ${formatMinorUnits(item.convertedNetAmount)}`
                    }
                  </div>
                </article>
              `
            )
            .join('')}
        </div>
      </section>
    </div>
  `;

  target.querySelector<HTMLFormElement>('[data-role="summary-memo-form"]')?.addEventListener('submit', async (event) => {
    event.preventDefault();
    const form = event.currentTarget as HTMLFormElement;
    const memo = (form.elements.namedItem('memo') as HTMLTextAreaElement).value;

    try {
      await updateBookMemo(db, {
        bookId: book.id,
        memo
      });
      onStatus?.('概览备忘录已保存');
      await onChange?.();
    } catch (error) {
      onStatus?.(error instanceof Error ? error.message : '保存备忘录失败');
    }
  });

  target.querySelector<HTMLSelectElement>('[data-role="dashboard-period"]')?.addEventListener('change', async (event) => {
    target.dataset.summaryPeriod = (event.currentTarget as HTMLSelectElement).value;
    await renderSummaryPanel({ db, book, target, onChange, onStatus });
  });
}
