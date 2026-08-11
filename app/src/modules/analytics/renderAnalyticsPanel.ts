import type { Book } from '../../shared/types/entities';
import { calculateAnalyticsSnapshot } from '../../domain/analytics/calculateAnalyticsSnapshot';
import { upsertExchangeRate } from '../../domain/settings/upsertExchangeRate';
import {
  formatDateForDateInput,
  formatIsoForDatetimeLocal,
  parseDatetimeLocalToIso
} from '../../shared/utils/datetimeLocal';
import { balanceToneClass, formatBalanceAmount } from '../../shared/utils/balanceDisplay';
import { escapeHtml } from '../../shared/utils/escapeHtml';
import { formatMinorUnits } from '../../shared/utils/money';
import { AssetTrackerDb } from '../../storage/db';

interface AnalyticsPanelContext {
  db: AssetTrackerDb;
  book: Book;
  target: HTMLElement;
  now?: string;
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

function shiftDays(isoString: string, days: number): string {
  const date = new Date(isoString);
  date.setDate(date.getDate() + days);
  return date.toISOString();
}

function formatLocalTimestamp(isoString: string): string {
  return formatIsoForDatetimeLocal(isoString).replace('T', ' ');
}

function buildTrendPath(values: number[], width = 760, height = 220): string {
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

function buildTrendArea(values: number[], width = 760, height = 220): string {
  if (values.length === 0) {
    return '';
  }

  const line = buildTrendPath(values, width, height);
  const lastX = values.length === 1 ? width / 2 : width;

  return `${line} L ${lastX.toFixed(2)} ${height - 16} L 0 ${height - 16} Z`;
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

function buildAxisGuides(values: number[], height = 220, tickCount = 4): AxisGuide[] {
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

function metricLabel(metric: 'net' | 'asset' | 'debt'): string {
  if (metric === 'asset') {
    return '资产';
  }

  if (metric === 'debt') {
    return '负债';
  }

  return '净资产';
}

function metricClassName(amount: number): string {
  return amount >= 0 ? 'positive' : 'negative';
}

function buildPieGradient(items: Array<{ amount: number }>): string {
  const palette = ['#667eea', '#764ba2', '#4facfe', '#43e97b', '#f093fb', '#f5576c'];
  const total = items.reduce((sum, item) => sum + Math.abs(item.amount), 0);

  if (total <= 0) {
    return 'conic-gradient(#e9ecef 0deg 360deg)';
  }

  let cursor = 0;

  return `conic-gradient(${items
    .slice(0, palette.length)
    .map((item, index) => {
      const start = cursor;
      cursor += (Math.abs(item.amount) / total) * 360;
      return `${palette[index]} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`;
    })
    .join(', ')})`;
}

function buildRadarPolygon(values: number[], radius = 88, center = 110): string {
  if (values.length === 0) {
    return '';
  }

  return values
    .map((value, index) => {
      const angle = (Math.PI * 2 * index) / values.length - Math.PI / 2;
      const scaledRadius = (Math.max(0, Math.min(100, value)) / 100) * radius;
      const x = center + Math.cos(angle) * scaledRadius;
      const y = center + Math.sin(angle) * scaledRadius;
      return `${x.toFixed(2)},${y.toFixed(2)}`;
    })
    .join(' ');
}

function readAnalyticsState(
  target: HTMLElement,
  defaultAsOf: string,
  defaultCompareAt: string
): {
  asOf: string;
  compareAt: string;
  metric: 'net' | 'asset' | 'debt';
  trendDays: string;
  forecastDays: string;
} {
  try {
    const state = target.dataset.analyticsState ? JSON.parse(target.dataset.analyticsState) : {};

    return {
      asOf: typeof state.asOf === 'string' ? state.asOf : formatIsoForDatetimeLocal(defaultAsOf),
      compareAt:
        typeof state.compareAt === 'string'
          ? state.compareAt
          : formatIsoForDatetimeLocal(defaultCompareAt),
      metric: state.metric === 'asset' || state.metric === 'debt' ? state.metric : 'net',
      trendDays: typeof state.trendDays === 'string' ? state.trendDays : '30',
      forecastDays: typeof state.forecastDays === 'string' ? state.forecastDays : '30'
    };
  } catch {
    return {
      asOf: formatIsoForDatetimeLocal(defaultAsOf),
      compareAt: formatIsoForDatetimeLocal(defaultCompareAt),
      metric: 'net',
      trendDays: '30',
      forecastDays: '30'
    };
  }
}

function buildLineChart(
  values: number[],
  labels: string[],
  ariaLabel: string,
  options: { lineClass?: string; areaClass?: string } = {}
): string {
  const ticks = buildAxisTicks(labels);
  const guides = buildAxisGuides(values);

  return `
    <div class="trend-chart trend-chart--framed">
      <div class="trend-y-axis">
        ${guides
          .map((guide) => `<span>${formatMinorUnits(Math.round(guide.value))}</span>`)
          .join('')}
      </div>
      <div class="trend-chart-canvas">
        <svg viewBox="0 0 760 220" preserveAspectRatio="none" role="img" aria-label="${escapeHtml(ariaLabel)}">
          ${guides
            .map(
              (guide) =>
                `<line class="chart-grid-line" x1="0" x2="760" y1="${guide.y.toFixed(2)}" y2="${guide.y.toFixed(2)}"></line>`
            )
            .join('')}
          <path class="trend-area ${options.areaClass ?? ''}" d="${buildTrendArea(values)}"></path>
          <path class="trend-line ${options.lineClass ?? ''}" d="${buildTrendPath(values)}"></path>
        </svg>
        <div class="trend-axis trend-axis--positioned">
          ${ticks
            .map(
              (item) =>
                `<span data-role="axis-tick" data-edge="${item.edge}" style="${item.position}">${escapeHtml(item.label)}</span>`
            )
            .join('')}
        </div>
      </div>
    </div>
  `;
}

export async function renderAnalyticsPanel({
  db,
  book,
  target,
  now,
  onChange,
  onStatus
}: AnalyticsPanelContext): Promise<void> {
  const defaultAsOf = now ?? new Date().toISOString();
  const defaultCompareAt = shiftDays(defaultAsOf, -30);
  const state = readAnalyticsState(target, defaultAsOf, defaultCompareAt);

  target.dataset.panel = 'analytics';
  target.innerHTML = `
    <div class="analytics-container">
      <aside class="analytics-controls">
        <section class="card">
          <div class="card-header">
            <h3>图表配置</h3>
            <span class="tag">沿用旧版布局</span>
          </div>
          <form data-role="analytics-form" class="chart-config">
            <label class="field-label">
              <span>观察时点</span>
              <input name="asOf" type="datetime-local" required value="${state.asOf}" />
            </label>
            <label class="field-label">
              <span>对比时点</span>
              <input name="compareAt" type="datetime-local" required value="${state.compareAt}" />
            </label>
            <label class="field-label">
              <span>趋势指标</span>
              <select name="metric">
                <option value="net" ${state.metric === 'net' ? 'selected' : ''}>净资产</option>
                <option value="asset" ${state.metric === 'asset' ? 'selected' : ''}>资产</option>
                <option value="debt" ${state.metric === 'debt' ? 'selected' : ''}>负债</option>
              </select>
            </label>
            <label class="field-label">
              <span>趋势范围</span>
              <select name="trendDays">
                <option value="7" ${state.trendDays === '7' ? 'selected' : ''}>最近 7 天</option>
                <option value="30" ${state.trendDays === '30' ? 'selected' : ''}>最近 30 天</option>
                <option value="90" ${state.trendDays === '90' ? 'selected' : ''}>最近 90 天</option>
                <option value="365" ${state.trendDays === '365' ? 'selected' : ''}>最近 365 天</option>
              </select>
            </label>
            <label class="field-label">
              <span>预测范围</span>
              <select name="forecastDays">
                <option value="14" ${state.forecastDays === '14' ? 'selected' : ''}>未来 14 天</option>
                <option value="30" ${state.forecastDays === '30' ? 'selected' : ''}>未来 30 天</option>
                <option value="60" ${state.forecastDays === '60' ? 'selected' : ''}>未来 60 天</option>
                <option value="90" ${state.forecastDays === '90' ? 'selected' : ''}>未来 90 天</option>
              </select>
            </label>
            <div class="action-row">
              <button type="submit" class="btn btn-primary">生成图表</button>
            </div>
            <p class="panel__empty analytics-tip">
              资产状态会从设置时点开始接管当前余额；更早的账单只回写过去，不会冲掉当前盘点值。
            </p>
          </form>
        </section>
      </aside>
      <div class="chart-display" data-role="analytics-content"></div>
    </div>
  `;

  const form = target.querySelector<HTMLFormElement>('[data-role="analytics-form"]');
  const content = target.querySelector<HTMLElement>('[data-role="analytics-content"]');

  if (!form || !content) {
    throw new Error('Missing analytics panel target');
  }

  const renderView = async (): Promise<void> => {
    const formData = new FormData(form);
    const asOfValue = String(formData.get('asOf') ?? '');
    const compareAtValue = String(formData.get('compareAt') ?? '');

    if (!asOfValue || !compareAtValue) {
      throw new Error('请选择完整的分析时间');
    }

    target.dataset.analyticsState = JSON.stringify({
      asOf: asOfValue,
      compareAt: compareAtValue,
      metric: String(formData.get('metric') ?? 'net'),
      trendDays: String(formData.get('trendDays') ?? '30'),
      forecastDays: String(formData.get('forecastDays') ?? '30')
    });

    const snapshot = await calculateAnalyticsSnapshot(db, {
      bookId: book.id,
      asOf: parseDatetimeLocalToIso(asOfValue),
      compareAt: parseDatetimeLocalToIso(compareAtValue),
      metric: String(formData.get('metric') ?? 'net') as 'net' | 'asset' | 'debt',
      trendDays: Number(formData.get('trendDays') ?? 30),
      forecastDays: Number(formData.get('forecastDays') ?? 30)
    });
    const trendValues = snapshot.trend.map((item) => item.value);
    const forecastValues = snapshot.forecast.map((item) => item.value);
    const compositionScaleMax = Math.max(
      ...snapshot.categoryComposition.map((item) => Math.abs(item.amount)),
      1
    );
    const cashflowScaleMax = Math.max(
      ...snapshot.cashflowProjection.map((item) => Math.abs(item.amount)),
      1
    );
    const pieGradient = buildPieGradient(snapshot.categoryComposition);
    const radarPolygon = buildRadarPolygon(snapshot.radarMetrics.map((item) => item.value));
    const unresolvedCurrencies = [
      ...new Set(
        snapshot.currencyComparison
          .filter(
            (item) =>
              item.currentConvertedNetAmount === null || item.compareConvertedNetAmount === null
          )
          .map((item) => item.currency)
      )
    ];

    content.innerHTML = `
      <section class="card">
        <div class="card-header">
          <h3>历史资产对比</h3>
          <span class="tag">基准币种 ${escapeHtml(book.baseCurrency)}</span>
        </div>
        <div class="summary-grid">
          <article class="summary-item">
            <span class="label">当前${metricLabel(snapshot.metric)}</span>
            <strong class="value">${formatMinorUnits(
              snapshot.metric === 'asset'
                ? snapshot.currentSummary.assetAmount
                : snapshot.metric === 'debt'
                  ? snapshot.currentSummary.debtAmount
                  : snapshot.currentSummary.netAmount
            )}</strong>
          </article>
          <article class="summary-item">
            <span class="label">对比时点</span>
            <strong class="value">${formatMinorUnits(
              snapshot.metric === 'asset'
                ? snapshot.compareSummary.assetAmount
                : snapshot.metric === 'debt'
                  ? snapshot.compareSummary.debtAmount
                  : snapshot.compareSummary.netAmount
            )}</strong>
          </article>
          <article class="summary-item">
            <span class="label">变动</span>
            <strong class="value">${formatMinorUnits(
              snapshot.metric === 'asset'
                ? snapshot.currentSummary.assetAmount - snapshot.compareSummary.assetAmount
                : snapshot.metric === 'debt'
                  ? snapshot.currentSummary.debtAmount - snapshot.compareSummary.debtAmount
                  : snapshot.currentSummary.netAmount - snapshot.compareSummary.netAmount
            )}</strong>
          </article>
          <article class="summary-item">
            <span class="label">锚点数量</span>
            <strong class="value">${snapshot.anchorTimeline.length}</strong>
          </article>
        </div>
        <div class="comparison-table">
          <table>
            <thead>
              <tr>
                <th>币种</th>
                <th>当前原币净额</th>
                <th>对比原币净额</th>
                <th>当前折算</th>
                <th>对比折算</th>
              </tr>
            </thead>
            <tbody>
              ${
                snapshot.currencyComparison.length === 0
                  ? '<tr><td colspan="5" class="panel__empty">当前时点没有可分析余额。</td></tr>'
                  : snapshot.currencyComparison
                      .map(
                        (item) => `
                          <tr>
                            <td>${escapeHtml(item.currency)}</td>
                            <td>${formatMinorUnits(item.currentNetAmount)}</td>
                            <td>${formatMinorUnits(item.compareNetAmount)}</td>
                            <td>${item.currentConvertedNetAmount === null ? '缺少汇率' : formatMinorUnits(item.currentConvertedNetAmount)}</td>
                            <td>${item.compareConvertedNetAmount === null ? '缺少汇率' : formatMinorUnits(item.compareConvertedNetAmount)}</td>
                          </tr>
                        `
                      )
                      .join('')
              }
            </tbody>
          </table>
        </div>
        ${
          unresolvedCurrencies.length > 0
            ? `
              <div class="analytics-inline-rate">
                <div class="card-header">
                  <h3>补充历史汇率</h3>
                  <span class="tag">避免历史对比缺少汇率</span>
                </div>
                <form data-role="historical-rate-form" class="stack-form">
                  <div class="form-grid three-columns">
                    <label class="field-label">
                      <span>币种</span>
                      <select name="currency">
                        ${unresolvedCurrencies
                          .map((currency) => `<option value="${currency}">${currency}</option>`)
                          .join('')}
                      </select>
                    </label>
                    <label class="field-label">
                      <span>生效日期</span>
                      <input name="effectiveFrom" type="date" required value="${formatDateForDateInput(snapshot.compareAt)}" />
                    </label>
                    <label class="field-label">
                      <span>汇率</span>
                      <input name="rate" type="number" min="0.0001" step="0.0001" required placeholder="1 外币 = ? ${escapeHtml(book.baseCurrency)}" />
                    </label>
                  </div>
                  <div class="action-row">
                    <button type="submit" class="btn btn-primary">保存历史汇率</button>
                  </div>
                </form>
              </div>
            `
            : ''
        }
      </section>
      <div class="analytics-rich-grid">
        <section class="card analytics-span-2">
          <div class="card-header">
            <h3>资产趋势</h3>
            <span class="tag">${escapeHtml(metricLabel(snapshot.metric))}</span>
          </div>
          ${buildLineChart(trendValues, snapshot.trend.map((item) => item.label), '资产趋势图')}
        </section>
        <section class="card analytics-span-2">
          <div class="card-header">
            <h3>未来预计曲线</h3>
            <span class="tag">周期扣款 / 工资预计</span>
          </div>
          ${buildLineChart(forecastValues, snapshot.forecast.map((item) => item.label), '未来预计曲线图', {
            lineClass: 'forecast-line',
            areaClass: 'forecast-area'
          })}
        </section>
        <section class="card">
          <div class="card-header">
            <h3>周期现金流热区</h3>
            <span class="tag">自动规则聚合</span>
          </div>
          <div class="analytics-category-list">
            ${
              snapshot.cashflowProjection.length === 0
                ? '<p class="panel__empty">当前没有启用中的周期现金流规则。</p>'
                : snapshot.cashflowProjection
                    .map(
                      (item) => `
                        <article class="analytics-category-item">
                          <div class="analytics-category-header">
                            <div>
                              <strong>${escapeHtml(item.label)}</strong>
                              <span>${escapeHtml(item.frequency)}</span>
                            </div>
                            <strong class="${metricClassName(item.amount)}">${formatMinorUnits(item.amount)}</strong>
                          </div>
                          <div class="analytics-category-bar">
                            <span style="width:${Math.max(6, Math.min(100, (Math.abs(item.amount) / cashflowScaleMax) * 100))}%"></span>
                          </div>
                        </article>
                      `
                    )
                    .join('')
            }
          </div>
        </section>
        <section class="card">
          <div class="card-header">
            <h3>结构分布雷达</h3>
            <span class="tag">资产健康度</span>
          </div>
          <div class="analytics-radar-layout">
            <svg viewBox="0 0 220 220" role="img" aria-label="结构分布雷达图">
              <circle cx="110" cy="110" r="88" class="radar-ring"></circle>
              <circle cx="110" cy="110" r="58" class="radar-ring"></circle>
              <circle cx="110" cy="110" r="28" class="radar-ring"></circle>
              <polygon points="${radarPolygon}" class="radar-shape"></polygon>
            </svg>
            <div class="analytics-pie-legend">
              ${snapshot.radarMetrics
                .map(
                  (item) => `
                    <div class="analytics-legend-item">
                      <span>${escapeHtml(item.label)}</span>
                      <strong>${item.value}%</strong>
                    </div>
                  `
                )
                .join('')}
            </div>
          </div>
        </section>
        <section class="card analytics-span-2">
          <div class="card-header">
            <h3>分类构成</h3>
            <span class="tag">时点 ${escapeHtml(formatLocalTimestamp(snapshot.asOf))}</span>
          </div>
          <div class="analytics-category-list">
            ${
              snapshot.categoryComposition.length === 0
                ? '<p class="panel__empty">这个时点没有有效分类余额。</p>'
                : snapshot.categoryComposition
                    .map(
                      (item) => `
                        <article class="analytics-category-item">
                          <div class="analytics-category-header">
                            <div>
                              <strong>${escapeHtml(item.name)}</strong>
                              <span>${escapeHtml(item.currency)} · ${escapeHtml(item.kind === 'debt' ? '负债' : '资产')}</span>
                            </div>
                            <strong class="${balanceToneClass(item.amount, item.kind)}">${formatBalanceAmount(item.amount, item.kind)}</strong>
                          </div>
                          <div class="analytics-category-bar">
                            <span style="width:${Math.max(6, Math.min(100, (Math.abs(item.amount) / compositionScaleMax) * 100))}%"></span>
                          </div>
                        </article>
                      `
                    )
                    .join('')
            }
          </div>
        </section>
        <section class="card">
          <div class="card-header">
            <h3>饼图构成</h3>
            <span class="tag">旧版饼图延续</span>
          </div>
          <div class="analytics-pie-layout">
            <div class="analytics-pie-chart" style="background:${pieGradient}"></div>
            <div class="analytics-pie-legend">
              ${
                snapshot.categoryComposition.length === 0
                  ? '<p class="panel__empty">没有可绘制的分类占比。</p>'
                  : snapshot.categoryComposition
                      .slice(0, 6)
                      .map(
                        (item, index) => `
                          <div class="analytics-legend-item">
                            <span class="analytics-legend-swatch analytics-legend-${index + 1}"></span>
                            <span>${escapeHtml(item.name)}</span>
                            <strong class="${balanceToneClass(item.amount, item.kind)}">${formatBalanceAmount(item.amount, item.kind)}</strong>
                          </div>
                        `
                      )
                      .join('')
              }
            </div>
          </div>
        </section>
        <section class="card">
          <div class="card-header">
            <h3>自定义分析</h3>
            <span class="tag">数据洞察</span>
          </div>
          <div class="comparison-table">
            <table>
              <thead>
                <tr>
                  <th>分析项</th>
                  <th>结果</th>
                </tr>
              </thead>
              <tbody>
                <tr>
                  <td>已分析账单数</td>
                  <td>${snapshot.currentSummary.transactionCount}</td>
                </tr>
                <tr>
                  <td>缺少汇率币种</td>
                  <td>${snapshot.currentSummary.unresolvedCurrencies.length === 0 ? '无' : escapeHtml(snapshot.currentSummary.unresolvedCurrencies.join(', '))}</td>
                </tr>
                <tr>
                  <td>最大分类敞口</td>
                  <td>${snapshot.categoryComposition[0] ? `${escapeHtml(snapshot.categoryComposition[0].name)} · ${formatBalanceAmount(snapshot.categoryComposition[0].amount, snapshot.categoryComposition[0].kind)}` : '无'}</td>
                </tr>
                <tr>
                  <td>最新资产状态</td>
                  <td>${snapshot.anchorTimeline[0] ? `${escapeHtml(snapshot.anchorTimeline[0].categoryName)} · ${escapeHtml(formatLocalTimestamp(snapshot.anchorTimeline[0].anchoredAt))}` : '未设置'}</td>
                </tr>
              </tbody>
            </table>
          </div>
        </section>
        <section class="card">
          <div class="card-header">
            <h3>资产状态时间线</h3>
            <span class="tag">盘点快照</span>
          </div>
          <div class="anchor-timeline">
            ${
              snapshot.anchorTimeline.length === 0
                ? '<p class="panel__empty">还没有资产状态锚点，建议先给关键账户做一次盘点。</p>'
                : snapshot.anchorTimeline
                    .map(
                      (item) => `
                        <article class="anchor-item">
                          <strong>${escapeHtml(item.categoryName)}</strong>
                          <span class="anchor-meta">${escapeHtml(formatLocalTimestamp(item.anchoredAt))} · ${escapeHtml(item.currency)}</span>
                          <span class="anchor-amount">${formatMinorUnits(item.amount)}</span>
                          <span class="anchor-note">${escapeHtml(item.note || '无备注')}</span>
                        </article>
                      `
                    )
                    .join('')
            }
          </div>
        </section>
        <section class="card">
          <div class="card-header">
            <h3>分类树快照</h3>
            <span class="tag">旧版层级布局</span>
          </div>
          <div class="analytics-tree">
            ${snapshot.categoryTree
              .map(
                (item) => `
                  <article class="analytics-tree-item">
                    <div>
                      <strong>${escapeHtml('— '.repeat(item.depth) + item.name)}</strong>
                    </div>
                    <strong class="${item.kind === 'debt' ? 'negative' : 'positive'}">${
                      item.aggregateAmount === null ? '多币种' : formatMinorUnits(item.aggregateAmount)
                    }</strong>
                  </article>
                `
              )
              .join('')}
          </div>
        </section>
      </div>
    `;

    content.querySelector<HTMLFormElement>('[data-role="historical-rate-form"]')?.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();
        const rateForm = event.currentTarget as HTMLFormElement;

        try {
          await upsertExchangeRate(db, {
            bookId: book.id,
            currency: (rateForm.elements.namedItem('currency') as HTMLSelectElement).value as
              | 'CNY'
              | 'SGD'
              | 'USD'
              | 'MYR',
            baseCurrency: book.baseCurrency,
            rate: Number((rateForm.elements.namedItem('rate') as HTMLInputElement).value),
            effectiveFrom: (rateForm.elements.namedItem('effectiveFrom') as HTMLInputElement).value
          });
          onStatus?.('历史汇率已保存');

          if (onChange) {
            await onChange();
            return;
          }

          await renderView();
        } catch (error) {
          onStatus?.(error instanceof Error ? error.message : '保存历史汇率失败');
        }
      }
    );
  };

  form.addEventListener('submit', async (event) => {
    event.preventDefault();

    try {
      await renderView();
    } catch (error) {
      content.innerHTML = `<section class="card"><p class="panel__empty">${
        error instanceof Error ? escapeHtml(error.message) : '图表生成失败'
      }</p></section>`;
    }
  });

  try {
    await renderView();
  } catch (error) {
    content.innerHTML = `<section class="card"><p class="panel__empty">${
      error instanceof Error ? escapeHtml(error.message) : '图表生成失败'
    }</p></section>`;
  }
}
