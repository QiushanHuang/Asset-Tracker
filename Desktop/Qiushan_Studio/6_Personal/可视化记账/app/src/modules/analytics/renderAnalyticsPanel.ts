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

interface AnalyticsPanelState {
  asOf: string;
  compareAt: string;
  metric: 'net' | 'asset' | 'debt';
  analysisPreset: '7' | '30' | '90' | '365' | 'year' | 'custom';
  analysisStart: string;
  analysisEnd: string;
  compositionMode: 'asset' | 'income' | 'expense';
  compositionPreset: 'day' | 'week' | 'month' | 'year' | 'custom';
  compositionStart: string;
  compositionEnd: string;
  piePreset: 'day' | 'week' | 'month' | 'year' | 'custom';
  pieStart: string;
  pieEnd: string;
  forecastDays: string;
}

interface AnalyticsTreeNode {
  item: Awaited<ReturnType<typeof calculateAnalyticsSnapshot>>['categoryTree'][number];
  children: AnalyticsTreeNode[];
}

interface AnalyticsMetricStats {
  total: number;
  average: number;
  peak: number;
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
  if (max === min) {
    const y = height / 2;

    return values
      .map((_, index) => {
        const x = values.length === 1 ? width / 2 : (index / (values.length - 1)) * width;
        return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`;
      })
      .join(' ');
  }

  const range = max - min;

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
  if (max === min) {
    return Array.from({ length: tickCount }, (_, index) => {
      const ratio = tickCount === 1 ? 0.5 : index / (tickCount - 1);

      return {
        value: max,
        y: 16 + ratio * (height - 32)
      };
    });
  }

  const range = max - min;

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

function buildMetricStats(values: number[]): AnalyticsMetricStats {
  if (values.length === 0) {
    return {
      total: 0,
      average: 0,
      peak: 0
    };
  }

  return {
    total: values.reduce((sum, value) => sum + value, 0),
    average: values.reduce((sum, value) => sum + value, 0) / values.length,
    peak: Math.max(...values)
  };
}

function averageLabel(bucket: 'day' | 'month'): string {
  return bucket === 'month' ? '月均' : '日均';
}

function buildPiePalette(count: number): string[] {
  const palette = [
    '#667eea',
    '#764ba2',
    '#4facfe',
    '#43e97b',
    '#f093fb',
    '#f5576c',
    '#f5af19',
    '#00c2ff',
    '#00c9a7',
    '#ffc75f',
    '#ff8066',
    '#8ec5fc'
  ];

  return Array.from({ length: count }, (_, index) => palette[index % palette.length]);
}

function buildPieGradient(items: Array<{ amount: number }>, palette: string[]): string {
  const total = items.reduce((sum, item) => sum + Math.abs(item.amount), 0);

  if (total <= 0) {
    return 'conic-gradient(#e9ecef 0deg 360deg)';
  }

  let cursor = 0;

  return `conic-gradient(${items
    .map((item, index) => {
      const start = cursor;
      cursor += (Math.abs(item.amount) / total) * 360;
      return `${palette[index]} ${start.toFixed(2)}deg ${cursor.toFixed(2)}deg`;
    })
    .join(', ')})`;
}

function buildRadarPolygon(values: number[], radius = 96, center = 120): string {
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

function buildRadarAxes(metricCount: number, radius = 96, center = 120): string {
  return Array.from({ length: metricCount }, (_, index) => {
    const angle = (Math.PI * 2 * index) / metricCount - Math.PI / 2;
    const x = center + Math.cos(angle) * radius;
    const y = center + Math.sin(angle) * radius;
    return `<line x1="${center}" y1="${center}" x2="${x.toFixed(2)}" y2="${y.toFixed(2)}" class="radar-axis"></line>`;
  }).join('');
}

function buildRadarLabelNodes(labels: string[], radius = 112, center = 120): string {
  return labels
    .map((label, index) => {
      const angle = (Math.PI * 2 * index) / labels.length - Math.PI / 2;
      const x = center + Math.cos(angle) * radius;
      const y = center + Math.sin(angle) * radius;

      return `<text x="${x.toFixed(2)}" y="${y.toFixed(2)}" class="radar-label">${escapeHtml(label)}</text>`;
    })
    .join('');
}

function readAnalyticsState(
  target: HTMLElement,
  defaultAsOf: string,
  defaultCompareAt: string
): AnalyticsPanelState {
  const defaultEndDate = formatDateForDateInput(defaultAsOf);
  const defaultStartDate = formatDateForDateInput(shiftDays(defaultAsOf, -29));

  try {
    const state = target.dataset.analyticsState ? JSON.parse(target.dataset.analyticsState) : {};

    return {
      asOf: typeof state.asOf === 'string' ? state.asOf : formatIsoForDatetimeLocal(defaultAsOf),
      compareAt:
        typeof state.compareAt === 'string'
          ? state.compareAt
          : formatIsoForDatetimeLocal(defaultCompareAt),
      metric: state.metric === 'asset' || state.metric === 'debt' ? state.metric : 'net',
      analysisPreset:
        state.analysisPreset === '7' ||
        state.analysisPreset === '90' ||
        state.analysisPreset === '365' ||
        state.analysisPreset === 'year' ||
        state.analysisPreset === 'custom'
          ? state.analysisPreset
          : '30',
      analysisStart:
        typeof state.analysisStart === 'string' ? state.analysisStart : defaultStartDate,
      analysisEnd: typeof state.analysisEnd === 'string' ? state.analysisEnd : defaultEndDate,
      compositionMode:
        state.compositionMode === 'income' || state.compositionMode === 'expense'
          ? state.compositionMode
          : 'asset',
      compositionPreset:
        state.compositionPreset === 'day' ||
        state.compositionPreset === 'week' ||
        state.compositionPreset === 'year' ||
        state.compositionPreset === 'custom'
          ? state.compositionPreset
          : 'month',
      compositionStart:
        typeof state.compositionStart === 'string' ? state.compositionStart : defaultStartDate,
      compositionEnd:
        typeof state.compositionEnd === 'string' ? state.compositionEnd : defaultEndDate,
      piePreset:
        state.piePreset === 'day' ||
        state.piePreset === 'week' ||
        state.piePreset === 'year' ||
        state.piePreset === 'custom'
          ? state.piePreset
          : 'month',
      pieStart: typeof state.pieStart === 'string' ? state.pieStart : defaultStartDate,
      pieEnd: typeof state.pieEnd === 'string' ? state.pieEnd : defaultEndDate,
      forecastDays: typeof state.forecastDays === 'string' ? state.forecastDays : '30'
    };
  } catch {
    return {
      asOf: formatIsoForDatetimeLocal(defaultAsOf),
      compareAt: formatIsoForDatetimeLocal(defaultCompareAt),
      metric: 'net',
      analysisPreset: '30',
      analysisStart: defaultStartDate,
      analysisEnd: defaultEndDate,
      compositionMode: 'asset',
      compositionPreset: 'month',
      compositionStart: defaultStartDate,
      compositionEnd: defaultEndDate,
      piePreset: 'month',
      pieStart: defaultStartDate,
      pieEnd: defaultEndDate,
      forecastDays: '30'
    };
  }
}

function persistAnalyticsState(target: HTMLElement, state: AnalyticsPanelState): void {
  target.dataset.analyticsState = JSON.stringify(state);
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

function formatCompositionAmount(
  amount: number,
  kind: 'asset' | 'debt' | 'income' | 'expense'
): string {
  if (kind === 'asset' || kind === 'debt') {
    return formatBalanceAmount(amount, kind);
  }

  return formatMinorUnits(amount);
}

function compositionToneClass(
  amount: number,
  kind: 'asset' | 'debt' | 'income' | 'expense'
): string {
  if (kind === 'asset' || kind === 'debt') {
    return balanceToneClass(amount, kind);
  }

  return kind === 'income' ? 'positive' : 'negative';
}

function compositionBarClass(kind: 'asset' | 'debt' | 'income' | 'expense'): string {
  if (kind === 'expense' || kind === 'debt') {
    return 'analytics-category-bar--expense';
  }

  if (kind === 'income') {
    return 'analytics-category-bar--income';
  }

  return '';
}

function buildTreeNodes(
  items: Awaited<ReturnType<typeof calculateAnalyticsSnapshot>>['categoryTree']
): AnalyticsTreeNode[] {
  const nodeById = new Map<string, AnalyticsTreeNode>();
  const roots: AnalyticsTreeNode[] = [];

  items.forEach((item) => {
    nodeById.set(item.id, {
      item,
      children: []
    });
  });

  items.forEach((item) => {
    const node = nodeById.get(item.id);

    if (!node) {
      return;
    }

    if (item.parentId && nodeById.has(item.parentId)) {
      nodeById.get(item.parentId)?.children.push(node);
      return;
    }

    roots.push(node);
  });

  return roots;
}

function buildBranchTreeIds(
  items: Awaited<ReturnType<typeof calculateAnalyticsSnapshot>>['categoryTree']
): string[] {
  const parentIds = new Set(
    items
      .map((item) => item.parentId)
      .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
  );

  return items.filter((item) => parentIds.has(item.id)).map((item) => item.id);
}

function readOpenTreeIds(target: HTMLElement, defaultIds: string[]): Set<string> {
  try {
    const raw = target.dataset.analyticsOpenTreeIds
      ? (JSON.parse(target.dataset.analyticsOpenTreeIds) as unknown)
      : defaultIds;

    if (!Array.isArray(raw)) {
      return new Set(defaultIds);
    }

    return new Set(
      raw.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
    );
  } catch {
    return new Set(defaultIds);
  }
}

function writeOpenTreeIds(target: HTMLElement, openIds: Set<string>): void {
  target.dataset.analyticsOpenTreeIds = JSON.stringify([...openIds]);
}

function renderTreeNodes(nodes: AnalyticsTreeNode[], openIds: Set<string>): string {
  return nodes
    .map((node) => {
      const value =
        node.item.aggregateAmount === null
          ? '多币种'
          : formatMinorUnits(node.item.aggregateAmount);
      const kindLabel =
        node.item.kind === 'group' ? '分组' : node.item.kind === 'debt' ? '负债' : '资产';
      const content = `
        <div class="analytics-tree-summary-row">
          <div class="analytics-tree-title">
            <strong>${escapeHtml(node.item.name)}</strong>
            <span>${escapeHtml(kindLabel)} · ${escapeHtml(node.item.currency)}</span>
          </div>
          <strong class="${node.item.kind === 'debt' ? 'negative' : 'positive'}">${value}</strong>
        </div>
      `;

      if (node.children.length === 0) {
        return `<article class="analytics-tree-leaf">${content}</article>`;
      }

      return `
        <details class="analytics-tree-branch" data-role="tree-node" data-tree-id="${node.item.id}" ${openIds.has(node.item.id) ? 'open' : ''}>
          <summary>${content}</summary>
          <div class="analytics-tree-children">
            ${renderTreeNodes(node.children, openIds)}
          </div>
        </details>
      `;
    })
    .join('');
}

function buildInsightRows(snapshot: Awaited<ReturnType<typeof calculateAnalyticsSnapshot>>): string {
  const exposureLabel =
    snapshot.categoryCompositionMode === 'income'
      ? '最高收入分类'
      : snapshot.categoryCompositionMode === 'expense'
        ? '最高支出分类'
        : '最大分类敞口';

  return `
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
        <td>${exposureLabel}</td>
        <td>${snapshot.categoryComposition[0] ? `${escapeHtml(snapshot.categoryComposition[0].name)} · ${formatCompositionAmount(snapshot.categoryComposition[0].amount, snapshot.categoryComposition[0].kind)}` : '无'}</td>
      </tr>
      <tr>
        <td>最新资产状态</td>
        <td>${snapshot.latestAnchor ? `${escapeHtml(snapshot.latestAnchor.categoryName)} · ${escapeHtml(formatLocalTimestamp(snapshot.latestAnchor.anchoredAt))}` : '未设置'}</td>
      </tr>
    </tbody>
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

  persistAnalyticsState(target, state);
  target.dataset.panel = 'analytics';
  target.innerHTML = `
    <div class="analytics-container analytics-container--stacked">
      <section class="card analytics-config-card" data-role="analytics-config">
        <div class="card-header">
          <h3>图表配置</h3>
          <span class="tag">范围、对比与预测</span>
        </div>
        <form data-role="analytics-form" class="chart-config chart-config--horizontal">
          <label class="field-label">
            <span>观察时点</span>
            <input name="asOf" type="datetime-local" required value="${state.asOf}" />
          </label>
          <label class="field-label">
            <span>对比时点</span>
            <input name="compareAt" type="datetime-local" required value="${state.compareAt}" />
          </label>
          <label class="field-label">
            <span>对比指标</span>
            <select name="metric">
              <option value="net" ${state.metric === 'net' ? 'selected' : ''}>净资产</option>
              <option value="asset" ${state.metric === 'asset' ? 'selected' : ''}>资产</option>
              <option value="debt" ${state.metric === 'debt' ? 'selected' : ''}>负债</option>
            </select>
          </label>
          <label class="field-label">
            <span>分析范围</span>
            <select name="analysisPreset" data-role="analysis-preset">
              <option value="7" ${state.analysisPreset === '7' ? 'selected' : ''}>最近 7 天</option>
              <option value="30" ${state.analysisPreset === '30' ? 'selected' : ''}>最近 30 天</option>
              <option value="90" ${state.analysisPreset === '90' ? 'selected' : ''}>最近 90 天</option>
              <option value="365" ${state.analysisPreset === '365' ? 'selected' : ''}>最近 365 天</option>
              <option value="year" ${state.analysisPreset === 'year' ? 'selected' : ''}>本年累计</option>
              <option value="custom" ${state.analysisPreset === 'custom' ? 'selected' : ''}>自定义</option>
            </select>
          </label>
          <label class="field-label">
            <span>自定义开始</span>
            <input name="analysisStart" type="date" value="${state.analysisStart}" />
          </label>
          <label class="field-label">
            <span>自定义结束</span>
            <input name="analysisEnd" type="date" value="${state.analysisEnd}" />
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
          <div class="action-row analytics-config-actions">
            <button type="submit" class="btn btn-primary">生成图表</button>
          </div>
          <p class="panel__empty analytics-tip">
            资产状态会从设置时点开始接管当前余额；更早的账单只回写过去，不会冲掉当前盘点值。
          </p>
        </form>
      </section>
      <div class="chart-display" data-role="analytics-content"></div>
    </div>
  `;

  const form = target.querySelector<HTMLFormElement>('[data-role="analytics-form"]');
  const content = target.querySelector<HTMLElement>('[data-role="analytics-content"]');

  if (!form || !content) {
    throw new Error('Missing analytics panel target');
  }

  const mergeState = (patch: Partial<AnalyticsPanelState>): AnalyticsPanelState => {
    const nextState = {
      ...readAnalyticsState(target, defaultAsOf, defaultCompareAt),
      ...patch
    };
    persistAnalyticsState(target, nextState);
    return nextState;
  };

  const renderView = async (): Promise<void> => {
    const currentState = readAnalyticsState(target, defaultAsOf, defaultCompareAt);

    if (!currentState.asOf || !currentState.compareAt) {
      throw new Error('请选择完整的分析时间');
    }

    const snapshot = await calculateAnalyticsSnapshot(db, {
      bookId: book.id,
      asOf: parseDatetimeLocalToIso(currentState.asOf),
      compareAt: parseDatetimeLocalToIso(currentState.compareAt),
      metric: currentState.metric,
      analysisPreset: currentState.analysisPreset,
      analysisStart: currentState.analysisStart,
      analysisEnd: currentState.analysisEnd,
      compositionMode: currentState.compositionMode,
      compositionPreset: currentState.compositionPreset,
      compositionStart: currentState.compositionStart,
      compositionEnd: currentState.compositionEnd,
      piePreset: currentState.piePreset,
      pieStart: currentState.pieStart,
      pieEnd: currentState.pieEnd,
      forecastDays: Number(currentState.forecastDays || '30')
    });
    const analysisIncomeValues = snapshot.analysisSeries.map((item) => item.income);
    const analysisExpenseValues = snapshot.analysisSeries.map((item) => item.expense);
    const analysisNetValues = snapshot.analysisSeries.map((item) => item.net);
    const incomeStats = buildMetricStats(analysisIncomeValues);
    const expenseStats = buildMetricStats(analysisExpenseValues);
    const netStats = buildMetricStats(analysisNetValues);
    const averageUnitLabel = averageLabel(snapshot.analysisRange.bucket);
    const forecastValues = snapshot.forecast.map((item) => item.value);
    const compositionScaleMax = Math.max(
      ...snapshot.categoryComposition.map((item) => Math.abs(item.amount)),
      1
    );
    const cashflowScaleMax = Math.max(
      ...snapshot.cashflowProjection.map((item) => Math.abs(item.amount)),
      1
    );
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
    const radarPolygon = buildRadarPolygon(snapshot.radarMetrics.map((item) => item.value));
    const branchTreeIds = buildBranchTreeIds(snapshot.categoryTree);
    const defaultOpenTreeIds: string[] = [];
    const openTreeIds = readOpenTreeIds(target, defaultOpenTreeIds);
    const treeMarkup = renderTreeNodes(buildTreeNodes(snapshot.categoryTree), openTreeIds);
    const assetCompositionMode = currentState.compositionMode === 'asset';

    content.innerHTML = `
      <section class="card" data-role="historical-comparison">
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
            <span class="label">资产锚点</span>
            <strong class="value">${snapshot.latestAnchor ? '已启用' : '未设置'}</strong>
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
        <section class="card analytics-span-4">
          <div class="card-header">
            <h3>收入分析</h3>
            <span class="tag">${escapeHtml(snapshot.analysisRange.label)}</span>
          </div>
          <div class="analytics-stat-strip">
            <article class="analytics-stat-chip">
              <span>总收入</span>
              <strong class="positive">${formatMinorUnits(incomeStats.total)}</strong>
            </article>
            <article class="analytics-stat-chip" data-role="income-average">
              <span>${escapeHtml(`${averageUnitLabel}收入`)}</span>
              <strong class="positive">${formatMinorUnits(Math.round(incomeStats.average))}</strong>
            </article>
            <article class="analytics-stat-chip">
              <span>峰值收入</span>
              <strong class="positive">${formatMinorUnits(incomeStats.peak)}</strong>
            </article>
          </div>
          ${buildLineChart(analysisIncomeValues, snapshot.analysisSeries.map((item) => item.label), '收入分析趋势图', {
            lineClass: 'income-line',
            areaClass: 'income-area'
          })}
        </section>
        <section class="card analytics-span-4">
          <div class="card-header">
            <h3>支出分析</h3>
            <span class="tag">${escapeHtml(snapshot.analysisRange.label)}</span>
          </div>
          <div class="analytics-stat-strip">
            <article class="analytics-stat-chip">
              <span>总支出</span>
              <strong class="negative">${formatMinorUnits(expenseStats.total)}</strong>
            </article>
            <article class="analytics-stat-chip" data-role="expense-average">
              <span>${escapeHtml(`${averageUnitLabel}支出`)}</span>
              <strong class="negative">${formatMinorUnits(Math.round(expenseStats.average))}</strong>
            </article>
            <article class="analytics-stat-chip">
              <span>峰值支出</span>
              <strong class="negative">${formatMinorUnits(expenseStats.peak)}</strong>
            </article>
          </div>
          ${buildLineChart(analysisExpenseValues, snapshot.analysisSeries.map((item) => item.label), '支出分析趋势图', {
            lineClass: 'expense-line',
            areaClass: 'expense-area'
          })}
        </section>
        <section class="card analytics-span-4">
          <div class="card-header">
            <h3>净收入分析</h3>
            <span class="tag">${escapeHtml(snapshot.analysisRange.label)}</span>
          </div>
          <div class="analytics-stat-strip">
            <article class="analytics-stat-chip">
              <span>净收入</span>
              <strong class="${metricClassName(netStats.total)}">${formatMinorUnits(netStats.total)}</strong>
            </article>
            <article class="analytics-stat-chip">
              <span>${escapeHtml(`${averageUnitLabel}净收入`)}</span>
              <strong class="${metricClassName(netStats.average)}">${formatMinorUnits(Math.round(netStats.average))}</strong>
            </article>
            <article class="analytics-stat-chip">
              <span>峰值净收入</span>
              <strong class="${metricClassName(netStats.peak)}">${formatMinorUnits(netStats.peak)}</strong>
            </article>
          </div>
          ${buildLineChart(analysisNetValues, snapshot.analysisSeries.map((item) => item.label), '净收入分析趋势图')}
        </section>
        <div class="analytics-balanced-row" data-role="forecast-balance-row">
          <section class="card analytics-span-7">
          <div class="card-header">
            <h3>未来预计曲线</h3>
            <span class="tag">周期扣款 / 工资预计</span>
          </div>
          ${buildLineChart(forecastValues, snapshot.forecast.map((item) => item.label), '未来预计曲线图', {
            lineClass: 'forecast-line',
            areaClass: 'forecast-area'
          })}
          </section>
          <section class="card analytics-span-5" data-role="pie-compositions-card">
            <div class="card-header">
              <h3>饼图构成</h3>
              <span class="tag">${escapeHtml(snapshot.pieRange.label)}</span>
            </div>
            <form data-role="pie-controls" class="analytics-subcontrols">
              <select name="piePreset" data-role="pie-preset">
                <option value="day" ${currentState.piePreset === 'day' ? 'selected' : ''}>日</option>
                <option value="week" ${currentState.piePreset === 'week' ? 'selected' : ''}>周</option>
                <option value="month" ${currentState.piePreset === 'month' ? 'selected' : ''}>月</option>
                <option value="year" ${currentState.piePreset === 'year' ? 'selected' : ''}>年</option>
                <option value="custom" ${currentState.piePreset === 'custom' ? 'selected' : ''}>自定义</option>
              </select>
              <input name="pieStart" type="date" value="${currentState.pieStart}" />
              <input name="pieEnd" type="date" value="${currentState.pieEnd}" />
              <button type="submit" class="btn btn-secondary btn-sm">更新饼图</button>
            </form>
            <div class="analytics-pie-stack">
              ${snapshot.pieCompositions
                .map(
                  (pie) => {
                    const piePalette = buildPiePalette(pie.items.length);

                    return `
                  <article class="analytics-pie-card">
                    <div class="analytics-pie-card-header">
                      <strong>${pie.mode === 'asset' ? '资产构成' : pie.mode === 'income' ? '收入用途构成' : '支出用途构成'}</strong>
                      <span>${escapeHtml(pie.label)}</span>
                    </div>
                    <div class="analytics-pie-layout">
                      <div class="analytics-pie-chart" data-role="composition-pie" data-mode="${pie.mode}" style="background:${buildPieGradient(pie.items, piePalette)}"></div>
                      <div class="analytics-pie-legend">
                        ${
                          pie.items.length === 0
                            ? '<p class="panel__empty">没有可绘制的占比。</p>'
                            : pie.items
                                .map(
                                  (item, index) => `
                                    <div class="analytics-legend-item">
                                      <span class="analytics-legend-swatch" style="background:${piePalette[index]}"></span>
                                      <span>${escapeHtml(item.name)}</span>
                                      <strong class="${compositionToneClass(item.amount, item.kind)}">${formatCompositionAmount(item.amount, item.kind)}</strong>
                                    </div>
                                  `
                                )
                                .join('')
                        }
                      </div>
                    </div>
                  </article>
                `;
                  }
                )
                .join('')}
            </div>
          </section>
        </div>
        <div class="analytics-balanced-row" data-role="composition-balance-row">
          <section class="card analytics-span-5" data-role="cashflow-heatmap-card">
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
          <section class="card analytics-span-7" data-role="category-composition-card">
          <div class="card-header">
            <h3>分类构成</h3>
            <span class="tag">${escapeHtml(assetCompositionMode ? '按观察时点' : snapshot.categoryCompositionRange.label)}</span>
          </div>
          <form data-role="composition-controls" class="analytics-subcontrols">
            <select name="compositionMode" data-role="composition-mode">
              <option value="asset" ${currentState.compositionMode === 'asset' ? 'selected' : ''}>资产</option>
              <option value="income" ${currentState.compositionMode === 'income' ? 'selected' : ''}>收入</option>
              <option value="expense" ${currentState.compositionMode === 'expense' ? 'selected' : ''}>支出</option>
            </select>
            <select name="compositionPreset" data-role="composition-preset" ${assetCompositionMode ? 'disabled' : ''}>
              <option value="day" ${currentState.compositionPreset === 'day' ? 'selected' : ''}>日</option>
              <option value="week" ${currentState.compositionPreset === 'week' ? 'selected' : ''}>周</option>
              <option value="month" ${currentState.compositionPreset === 'month' ? 'selected' : ''}>月</option>
              <option value="year" ${currentState.compositionPreset === 'year' ? 'selected' : ''}>年</option>
              <option value="custom" ${currentState.compositionPreset === 'custom' ? 'selected' : ''}>自定义</option>
            </select>
            <input name="compositionStart" type="date" value="${currentState.compositionStart}" ${assetCompositionMode ? 'disabled' : ''} />
            <input name="compositionEnd" type="date" value="${currentState.compositionEnd}" ${assetCompositionMode ? 'disabled' : ''} />
            <button type="submit" class="btn btn-secondary btn-sm">${assetCompositionMode ? '刷新资产构成' : '更新构成'}</button>
          </form>
          ${
            assetCompositionMode
              ? '<p class="panel__empty analytics-tip">资产构成按观察时点统计，时间区间仅在收入和支出模式下生效。</p>'
              : ''
          }
          <div class="analytics-category-list">
            ${
              snapshot.categoryComposition.length === 0
                ? '<p class="panel__empty">这个时点没有有效分类数据。</p>'
                : snapshot.categoryComposition
                    .map(
                      (item) => `
                        <article class="analytics-category-item">
                          <div class="analytics-category-header">
                            <div>
                              <strong>${escapeHtml(item.name)}</strong>
                              <span>${escapeHtml(item.currency)} · ${escapeHtml(item.kind === 'expense' ? '支出' : item.kind === 'income' ? '收入' : item.kind === 'debt' ? '负债' : '资产')}</span>
                            </div>
                            <strong class="${compositionToneClass(item.amount, item.kind)}">${formatCompositionAmount(item.amount, item.kind)}</strong>
                          </div>
                          <div class="analytics-category-bar ${compositionBarClass(item.kind)}">
                            <span style="width:${Math.max(6, Math.min(100, (Math.abs(item.amount) / compositionScaleMax) * 100))}%"></span>
                          </div>
                        </article>
                      `
                    )
                    .join('')
            }
          </div>
          </section>
        </div>
        <div class="analytics-balanced-row" data-role="snapshot-balance-row">
          <div class="analytics-card-stack analytics-card-stack--balanced analytics-span-5" data-role="snapshot-side-stack">
          <section class="card" data-role="radar-card">
            <div class="card-header">
              <h3>结构分布雷达</h3>
              <span class="tag">资产健康度</span>
            </div>
            <div class="analytics-radar-board">
              <div class="analytics-radar-layout">
                <svg viewBox="0 0 240 240" role="img" aria-label="结构分布雷达图">
                  <circle cx="120" cy="120" r="96" class="radar-ring"></circle>
                  <circle cx="120" cy="120" r="64" class="radar-ring"></circle>
                  <circle cx="120" cy="120" r="32" class="radar-ring"></circle>
                  ${buildRadarAxes(snapshot.radarMetrics.length)}
                  <polygon points="${radarPolygon}" class="radar-shape"></polygon>
                  ${buildRadarLabelNodes(snapshot.radarMetrics.map((item) => item.label))}
                </svg>
              </div>
              <div class="analytics-radar-metrics" data-role="radar-metric-grid">
                ${snapshot.radarMetrics
                  .map(
                    (item) => `
                      <article class="analytics-radar-metric">
                        <span>${escapeHtml(item.label)}</span>
                        <strong>${item.value}%</strong>
                        <small>${escapeHtml(item.note)}</small>
                      </article>
                    `
                  )
                  .join('')}
              </div>
            </div>
          </section>
          <section class="card" data-role="custom-insights-card">
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
                ${buildInsightRows(snapshot)}
              </table>
            </div>
          </section>
          </div>
          <section class="card analytics-span-7" data-role="tree-snapshot-card">
          <div class="card-header">
            <h3>分类树快照</h3>
            <div class="card-header-actions" data-role="tree-controls">
              <span class="tag">默认折叠</span>
              <button type="button" class="btn btn-secondary btn-sm" data-action="expand-all" data-role="expand-tree-all">全部展开</button>
              <button type="button" class="btn btn-secondary btn-sm" data-action="collapse-all" data-role="collapse-tree-all">全部折叠</button>
            </div>
          </div>
          <div class="analytics-tree">
            ${treeMarkup || '<p class="panel__empty">暂无分类树数据。</p>'}
          </div>
          </section>
        </div>
      </div>
    `;

    content.querySelectorAll<HTMLDetailsElement>('[data-role="tree-node"]').forEach((details) => {
      details.addEventListener('toggle', () => {
        const nextOpenIds = readOpenTreeIds(target, defaultOpenTreeIds);
        const treeId = details.dataset.treeId;

        if (!treeId) {
          return;
        }

        if (details.open) {
          nextOpenIds.add(treeId);
        } else {
          nextOpenIds.delete(treeId);
        }

        writeOpenTreeIds(target, nextOpenIds);
      });
    });

    content.querySelector<HTMLElement>('[data-role="tree-controls"]')?.addEventListener('click', (event) => {
      const actionButton = (event.target as HTMLElement).closest<HTMLButtonElement>('button[data-action]');

      if (!actionButton) {
        return;
      }

      const nextOpenIds =
        actionButton.dataset.action === 'expand-all' ? new Set(branchTreeIds) : new Set<string>();

      writeOpenTreeIds(target, nextOpenIds);

      content.querySelectorAll<HTMLDetailsElement>('[data-role="tree-node"]').forEach((details) => {
        details.open = nextOpenIds.has(details.dataset.treeId ?? '');
      });
    });

    content.querySelector<HTMLFormElement>('[data-role="composition-controls"]')?.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();
        const compositionForm = event.currentTarget as HTMLFormElement;

        mergeState({
          compositionMode: (compositionForm.elements.namedItem('compositionMode') as HTMLSelectElement)
            .value as AnalyticsPanelState['compositionMode'],
          compositionPreset: (compositionForm.elements.namedItem('compositionPreset') as HTMLSelectElement)
            .value as AnalyticsPanelState['compositionPreset'],
          compositionStart: (compositionForm.elements.namedItem('compositionStart') as HTMLInputElement)
            .value,
          compositionEnd: (compositionForm.elements.namedItem('compositionEnd') as HTMLInputElement)
            .value
        });
        await renderView();
      }
    );

    content.querySelector<HTMLFormElement>('[data-role="pie-controls"]')?.addEventListener(
      'submit',
      async (event) => {
        event.preventDefault();
        const pieForm = event.currentTarget as HTMLFormElement;

        mergeState({
          piePreset: (pieForm.elements.namedItem('piePreset') as HTMLSelectElement)
            .value as AnalyticsPanelState['piePreset'],
          pieStart: (pieForm.elements.namedItem('pieStart') as HTMLInputElement).value,
          pieEnd: (pieForm.elements.namedItem('pieEnd') as HTMLInputElement).value
        });
        await renderView();
      }
    );

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
    const formData = new FormData(form);

    mergeState({
      asOf: String(formData.get('asOf') ?? ''),
      compareAt: String(formData.get('compareAt') ?? ''),
      metric: String(formData.get('metric') ?? 'net') as AnalyticsPanelState['metric'],
      analysisPreset: String(formData.get('analysisPreset') ?? '30') as AnalyticsPanelState['analysisPreset'],
      analysisStart: String(formData.get('analysisStart') ?? ''),
      analysisEnd: String(formData.get('analysisEnd') ?? ''),
      forecastDays: String(formData.get('forecastDays') ?? '30')
    });

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
