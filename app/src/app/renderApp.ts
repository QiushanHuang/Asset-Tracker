import type { Book } from '../shared/types/entities';
import { AssetTrackerDb } from '../storage/db';
import { renderAutomationPanel } from '../modules/automation/renderAutomationPanel';
import { renderAnalyticsPanel } from '../modules/analytics/renderAnalyticsPanel';
import { renderCategoryPanel } from '../modules/categories/renderCategoryPanel';
import { renderSummaryPanel } from '../modules/dashboard/renderSummaryPanel';
import { renderImportExportPanel } from '../modules/importExport/renderImportExportPanel';
import { renderSettingsPanel } from '../modules/settings/renderSettingsPanel';
import { renderTransactionPanel } from '../modules/transactions/renderTransactionPanel';
import { getInitialRoute, type AppRoute } from './router';

export interface AppRenderContext {
  db: AssetTrackerDb;
  book: Book;
  target: HTMLElement;
}

export async function renderApp({ db, book, target }: AppRenderContext): Promise<void> {
  let currentBook = book;
  target.innerHTML = `
    <section id="dashboard" class="content-section active">
      <div class="dashboard-grid">
        <div data-panel="summary"></div>
      </div>
    </section>
    <section id="categories" class="content-section">
      <div class="categories-container">
        <div data-panel="categories"></div>
      </div>
    </section>
    <section id="transactions" class="content-section">
      <div class="transactions-container">
        <div data-panel="transactions"></div>
      </div>
    </section>
    <section id="automation" class="content-section">
      <div class="automation-container">
        <div data-panel="automation"></div>
      </div>
    </section>
    <section id="analytics" class="content-section">
      <div class="analytics-panel-shell">
        <div data-panel="analytics"></div>
      </div>
    </section>
    <section id="settings" class="content-section">
      <div class="settings-container">
        <div data-panel="settings"></div>
      </div>
    </section>
    <section id="import-export" class="content-section">
      <div class="import-export-container">
        <div data-panel="import-export"></div>
      </div>
    </section>
  `;

  const navLinks = Array.from(document.querySelectorAll<HTMLAnchorElement>('.nav-link'));
  const sectionTitle = document.getElementById('section-title');
  const sectionTitles: Record<AppRoute, string> = {
    dashboard: '资产概览',
    categories: '分类管理',
    transactions: '账单记录',
    automation: '自动记账',
    analytics: '数据分析',
    settings: '系统设置',
    'import-export': '导入导出'
  };

  const setRoute = (route: AppRoute): void => {
    navLinks.forEach((link) => {
      const isActive = link.dataset.section === route;
      link.classList.toggle('active', isActive);
    });

    target.querySelectorAll<HTMLElement>('.content-section').forEach((section) => {
      section.classList.toggle('active', section.id === route);
    });

    if (sectionTitle) {
      sectionTitle.textContent = sectionTitles[route];
    }
  };

  navLinks.forEach((link) => {
    link.addEventListener('click', (event) => {
      event.preventDefault();
      const route = link.dataset.section as AppRoute | undefined;

      if (route) {
        setRoute(route);
      }
    });
  });

  setRoute(getInitialRoute());

  const summaryTarget = target.querySelector<HTMLElement>('#dashboard [data-panel="summary"]');
  const categoryTarget = target.querySelector<HTMLElement>('#categories [data-panel="categories"]');
  const transactionTarget = target.querySelector<HTMLElement>('#transactions [data-panel="transactions"]');
  const automationTarget = target.querySelector<HTMLElement>('#automation [data-panel="automation"]');
  const analyticsTarget = target.querySelector<HTMLElement>('#analytics [data-panel="analytics"]');
  const settingsTarget = target.querySelector<HTMLElement>('#settings [data-panel="settings"]');
  const importExportTarget = target.querySelector<HTMLElement>('#import-export [data-panel="import-export"]');
  const bootStatus = document.querySelector<HTMLElement>('[data-role="boot-status"]');
  const addTransactionButton = document.getElementById('add-transaction-btn');
  const backupButton = document.getElementById('backup-btn');

  if (
    !summaryTarget ||
    !categoryTarget ||
    !transactionTarget ||
    !automationTarget ||
    !analyticsTarget ||
    !settingsTarget ||
    !importExportTarget
  ) {
    throw new Error('Missing workspace panel target');
  }

  const setStatus = (message: string): void => {
    if (bootStatus) {
      bootStatus.textContent = message;
    }
  };

  addTransactionButton?.addEventListener('click', () => {
    setRoute('transactions');
  });

  backupButton?.addEventListener('click', () => {
    setRoute('import-export');
  });

  let refreshQueue = Promise.resolve();

  const runRefresh = async (): Promise<void> => {
    const latestBook = await db.books.get(currentBook.id);

    if (!latestBook) {
      throw new Error('Book does not exist');
    }

    currentBook = latestBook;

    await Promise.all([
      renderSummaryPanel({
        db,
        book: currentBook,
        target: summaryTarget,
        onChange: refresh,
        onStatus: setStatus
      }),
      renderCategoryPanel({
        db,
        book: currentBook,
        target: categoryTarget,
        onChange: refresh,
        onStatus: setStatus
      }),
      renderTransactionPanel({
        db,
        book: currentBook,
        target: transactionTarget,
        onChange: refresh,
        onStatus: setStatus
      }),
      renderAutomationPanel({
        db,
        book: currentBook,
        target: automationTarget,
        onChange: refresh,
        onStatus: setStatus
      }),
      renderAnalyticsPanel({
        db,
        book: currentBook,
        target: analyticsTarget,
        onChange: refresh,
        onStatus: setStatus
      }),
      renderSettingsPanel({
        db,
        book: currentBook,
        target: settingsTarget,
        onChange: refresh,
        onStatus: setStatus
      }),
      renderImportExportPanel({
        db,
        book: currentBook,
        target: importExportTarget,
        onChange: refresh,
        onStatus: setStatus
      })
    ]);
  };

  const refresh = (): Promise<void> => {
    const nextRefresh = refreshQueue.then(runRefresh);
    refreshQueue = nextRefresh.catch(() => undefined);
    return nextRefresh;
  };

  await refresh();
}
