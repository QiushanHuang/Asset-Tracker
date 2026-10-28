const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('../app/node_modules/jsdom');
const { loadAssetTracker } = require('./helpers/asset-tracker-harness');
const Projects = require('../expense-projects');

function fixture(t, confirmResult = true) {
  const dom = new JSDOM(fs.readFileSync(require.resolve('../index.html'), 'utf8'), { url: 'http://localhost' });
  const listen = dom.window.document.addEventListener.bind(dom.window.document);
  dom.window.document.addEventListener = (name, ...args) => { if (name !== 'DOMContentLoaded') listen(name, ...args); };
  const app = loadAssetTracker({ document: dom.window.document, confirmResult, lockManager: { request: async (_name, callback) => callback() } });
  app.context.URL = dom.window.URL;
  app.context.AbortController = AbortController;
  const tracker = new app.AssetTracker();
  tracker.data = tracker.getDefaultState();
  tracker.setupNavigation();
  t.after(() => { app.dispose(); dom.window.close(); });
  return { tracker, doc: dom.window.document, app };
}

test('changing the project filter preserves the dates already chosen', t => {
  const { tracker, doc } = fixture(t);
  const project = Projects.createProject('旅行', false);
  tracker.data.expenseProjects = [project];
  tracker.data.transactions = [
    { id: 'inside', date: '2026-01-15', category: '现金', amount: -10, currency: 'CNY', projectId: project.id },
    { id: 'outside', date: '2025-01-15', category: '现金', amount: -20, currency: 'CNY', projectId: project.id }
  ];
  tracker.setupProjectUI();
  doc.getElementById('date-from').value = '2026-01-01';
  doc.getElementById('date-to').value = '2026-01-31';
  const filter = doc.getElementById('project-filter');
  filter.value = project.id;
  filter.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert.equal(doc.getElementById('date-from').value, '2026-01-01');
  assert.equal(doc.getElementById('date-to').value, '2026-01-31');
  assert.match(doc.getElementById('transaction-count').textContent, /共 1 笔/);
});

test('date and account filters update the results when changed', t => {
  const { tracker, doc } = fixture(t);
  tracker.data.transactions = [
    { id: 'one', date: '2026-01-15', category: '现金', amount: -10, currency: 'CNY' },
    { id: 'two', date: '2025-01-15', category: '银行卡', amount: -20, currency: 'CNY' }
  ];
  tracker.setupEventListeners();
  tracker.renderTransactions();
  const from = doc.getElementById('date-from');
  from.value = '2026-01-01';
  from.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert.match(doc.getElementById('transaction-count').textContent, /共 1 笔/);
  from.value = '';
  const category = doc.getElementById('category-filter');
  category.add(new doc.defaultView.Option('银行卡', '银行卡'));
  category.value = '银行卡';
  category.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert.match(doc.getElementById('transaction-count').textContent, /共 1 笔/);
});

test('empty and populated project views have one clear creation action', t => {
  const { tracker, doc } = fixture(t);
  tracker.data.expenseProjects = [];
  tracker.setupProjectUI();
  assert.equal(doc.querySelectorAll('#projects [data-project-action="new"]').length, 1);
  doc.querySelector('#projects [data-project-action="new"]').click();
  assert.ok(doc.getElementById('project-name'));
  tracker.data.expenseProjects = [Projects.createProject('旅行', false)];
  tracker.renderProjectWorkspace();
  assert.equal(doc.querySelectorAll('#projects [data-project-action="new"]').length, 1);
});

test('the entry form exposes its date and identifies the currency control', t => {
  const { tracker, doc } = fixture(t);
  tracker.showTransactionModal();
  const date = doc.getElementById('transaction-date');
  assert.equal(date.closest('details'), null);
  assert.ok(date.labels.length);
  assert.equal(doc.getElementById('transaction-currency').getAttribute('aria-label'), '账单币种');
  assert.equal(doc.getElementById('amount-hint').hidden, true);
});

test('native dialog retains labelled dialog semantics and an inert background without WebKit modal hiding', t => {
  const { tracker, doc, app } = fixture(t);
  app.context.window.AssetTrackerHost.isNative = true;
  tracker.showTransactionModal();
  const modal = doc.getElementById('modal');
  assert.equal(modal.getAttribute('role'), 'dialog');
  assert.equal(modal.getAttribute('aria-labelledby'), 'modal-title');
  assert.equal(modal.hasAttribute('aria-modal'), false);
  assert.equal(doc.getElementById('normal-app-shell').inert, true);
  assert.ok(modal.contains(doc.activeElement));
});

test('full-book replacement is grouped with recovery and states its effect', t => {
  const { doc } = fixture(t);
  const replace = doc.getElementById('import-book-btn');
  const recovery = replace.closest('.danger-zone');
  assert.ok(recovery);
  assert.match(recovery.textContent, /替换当前/);
  assert.match(recovery.textContent, /账单|账本/);
});

test('account groups expose keyboard-operable expansion and retain focus', t => {
  const { tracker, doc } = fixture(t);
  tracker.data.categories = { group: { id: 'g', name: '银行卡', children: { cash: { id: 'c', name: '储蓄卡', balance: 20, currency: 'CNY' } } } };
  tracker.persistData = async () => {};
  tracker.renderCategories();
  const toggle = doc.querySelector('[data-category-toggle="g"]');
  assert.ok(toggle);
  assert.equal(toggle.getAttribute('aria-expanded'), 'true');
  toggle.focus();
  new Function('event', 'window', toggle.getAttribute('onclick'))({ stopPropagation() {} }, { assetTracker: tracker });
  const updated = doc.querySelector('[data-category-toggle="g"]');
  assert.equal(updated.getAttribute('aria-expanded'), 'false');
  assert.equal(doc.querySelector('.category-children').classList.contains('collapsed'), true);
  assert.equal(doc.activeElement, updated);
  const detail = doc.querySelector('.category-summary-info');
  assert.ok(detail && !detail.open);
  assert.match(detail.textContent, /资产|余额/);
});

test('accounts with missing exchange rates never display a fabricated converted balance', t => {
  const { tracker, doc } = fixture(t);
  tracker.data.settings.exchangeRates = {};
  tracker.data.categories = { group: { id: 'g', name: '外币', children: { eur: { id: 'e', name: '欧元账户', balance: 20, currency: 'EUR' } } } };
  tracker.renderCategories();
  const items = doc.querySelectorAll('.category-item');
  assert.equal(items[0].querySelector('.category-balance').textContent, '—');
  assert.equal(items[1].querySelector('.category-balance').textContent, '—');
  assert.match(items[0].querySelector('.category-summary-info').textContent, /EUR.*汇率/);
  assert.match(items[1].textContent, /20/);
});

test('workspace settings reveal which section is selected', async t => {
  const { tracker, doc } = fixture(t);
  await tracker.setupWorkspace();
  const layout = doc.querySelector('.ws-settings-tabs [data-ws-action="layout"]');
  const connection = doc.querySelector('.ws-settings-tabs [data-ws-action="connection"]');
  assert.equal(layout.getAttribute('aria-pressed'), 'true');
  assert.equal(connection.getAttribute('aria-pressed'), 'false');
  tracker.openWorkspaceSettings('connection');
  assert.equal(layout.getAttribute('aria-pressed'), 'false');
  assert.equal(connection.getAttribute('aria-pressed'), 'true');
  assert.equal(doc.getElementById('workspace-layout-settings').hidden, true);
  assert.equal(doc.getElementById('workspace-connection-settings').hidden, false);
});

test('mobile navigation exposes the current page and whether the menu is open', async t => {
  const { tracker, doc } = fixture(t);
  await tracker.setupWorkspace();
  doc.querySelector('.nav-link[data-section="transactions"]').click();
  const bills = doc.querySelector('#workspace-mobile-nav [data-ws-action="transactions"]');
  const more = doc.querySelector('#workspace-mobile-nav [data-ws-action="mobile-more"]');
  assert.equal(bills.getAttribute('aria-current'), 'page');
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  more.click();
  assert.equal(more.getAttribute('aria-expanded'), 'true');
  doc.querySelector('.nav-link[data-section="settings"]').click();
  assert.equal(more.getAttribute('aria-expanded'), 'false');
  assert.equal(more.getAttribute('aria-current'), 'page');
  assert.equal(bills.hasAttribute('aria-current'), false);
  doc.querySelector('.nav-link[data-section="nas"]').click();
  const quick = doc.querySelector('#workspace-mobile-nav [data-ws-action="quick-entry"]');
  assert.equal(quick.hidden, true);
  doc.querySelector('.nav-link[data-section="dashboard"]').click();
  assert.equal(quick.hidden, false);
});

test('an incomplete review draft shows what to fix before enabling confirmation', async t => {
  const { tracker, doc } = fixture(t);
  await tracker.setupWorkspace();
  tracker.ws.drafts = [{ id: 'draft-one', status: 'pending', source: 'rule', proposal: { date: '2026-10-28', amount: '20', direction: 'expense', currency: 'CNY', accountId: '', purpose: '', description: '测试', projectId: '', expenseCategoryId: '' } }];
  tracker.ws.focusId = 'draft-one';
  tracker.renderWorkspaceReview();
  const confirm = doc.getElementById('ws-confirm-draft');
  assert.equal(confirm.disabled, true);
  assert.match(doc.getElementById('ws-draft-submit-hint').textContent, /资金账户/);
  const account = doc.getElementById('ws-draft-account');
  account.value = 'cash-cny';
  account.dispatchEvent(new doc.defaultView.Event('change', { bubbles: true }));
  assert.equal(confirm.disabled, false);
  assert.match(doc.getElementById('ws-draft-submit-hint').textContent, /余额/);
});

test('cancelling a project category deletion preserves the category and explains the consequence', async t => {
  let prompt = '';
  const { tracker } = fixture(t, message => { prompt = message; return false; });
  const project = Projects.createProject('旅行', false);
  project.categories.push({ id: 'food', name: '餐饮', parentId: null });
  tracker.data.expenseProjects = [project];
  tracker.projectViewId = project.id;
  let writes = 0;
  tracker.persistData = async () => { writes++; };
  await tracker.deleteExpenseCategory('food');
  assert.match(prompt, /删除|移除/);
  assert.match(prompt, /账单/);
  assert.equal(writes, 0);
  assert.equal(tracker.data.expenseProjects[0].categories.length, 1);
});

test('account deletion explains retained bills and waits for durable confirmation', async t => {
  let allow = false, prompt = '';
  const { tracker } = fixture(t, message => { prompt = message; return allow; });
  tracker.data.categories = { cash: { id: 'cash', name: '现金', balance: 30, currency: 'CNY' } };
  tracker.data.transactions = [{ id: 't', category: '现金', accountId: 'cash', amount: -5, currency: 'CNY', date: '2026-01-01' }];
  tracker.assertWritable = () => {};
  let finish, writes = 0;
  tracker.persistData = () => { writes++; return new Promise(resolve => { finish = resolve; }); };
  tracker.renderCategories = tracker.updateDashboard = () => {};
  const messages = [];
  tracker.showMessage = (message, kind) => messages.push({ message, kind });
  await tracker.deleteCategory('cash');
  assert.match(prompt, /账单.*保留/);
  assert.equal(writes, 0);
  assert.ok(tracker.data.categories.cash);
  allow = true;
  const saving = tracker.deleteCategory('cash');
  await tracker.deleteCategory('cash');
  assert.equal(writes, 1);
  assert.equal(messages.some(item => item.kind === 'success'), false);
  finish();
  await saving;
  assert.equal(tracker.data.transactions.length, 1);
  assert.ok(messages.some(item => item.kind === 'success'));
});

test('automation rule controls persist changes and cancellation never removes a rule', async t => {
  let allow = false, prompt = '';
  const { tracker } = fixture(t, message => { prompt = message; return allow; });
  tracker.data.automationRules = [{ id: 'r', name: '房租', category: '现金', amount: -10, frequency: 'monthly', startDate: '2026-01-01', active: true }];
  tracker.assertWritable = () => {};
  let writes = 0;
  tracker.persistData = async () => { writes++; };
  tracker.showMessage = () => {};
  await tracker.toggleRule('r');
  assert.equal(tracker.data.automationRules[0].active, false);
  assert.equal(writes, 1);
  await tracker.deleteRule('r');
  assert.match(prompt, /账单/);
  assert.equal(tracker.data.automationRules.length, 1);
  assert.equal(writes, 1);
  allow = true;
  await tracker.deleteRule('r');
  assert.equal(tracker.data.automationRules.length, 0);
  assert.equal(writes, 2);
});

test('creating a periodic rule waits for confirmed saving and blocks duplicate submissions', async t => {
  const { tracker, doc } = fixture(t);
  tracker.assertWritable = () => {};
  tracker.showAutomationRuleModal();
  doc.getElementById('rule-name').value = '测试订阅';
  doc.getElementById('rule-category').value = '现金';
  doc.getElementById('rule-amount').value = '-10';
  doc.getElementById('rule-start-date').value = '2026-01-01';
  let finish, writes = 0;
  tracker.persistData = () => { writes++; return new Promise(resolve => { finish = resolve; }); };
  const messages = [];
  tracker.showMessage = (message, kind) => messages.push({ message, kind });
  const saving = tracker.submitAutomationRule();
  await tracker.submitAutomationRule();
  assert.equal(writes, 1);
  assert.equal(doc.getElementById('modal').style.display, 'block');
  assert.equal(messages.some(item => item.kind === 'success'), false);
  assert.equal(doc.querySelector('#automation-rule-form button[type="submit"]').disabled, true);
  finish();
  await saving;
  assert.equal(doc.getElementById('modal').style.display, 'none');
  assert.equal(messages.some(item => item.kind === 'success'), true);
  assert.equal(tracker.data.automationRules.length, 1);
});

test('creating a periodic rule refreshes the ready workspace and closes the form', async t => {
  const { tracker, doc } = fixture(t);
  await tracker.setupWorkspace();
  tracker.assertWritable = () => {};
  tracker.showAutomationRuleModal();
  doc.getElementById('rule-name').value = '测试订阅';
  doc.getElementById('rule-category').value = '现金';
  doc.getElementById('rule-amount').value = '-10';
  doc.getElementById('rule-start-date').value = '2026-10-28';
  tracker.persistData = async () => { tracker.data = tracker.normalizeLoadedData(tracker.data); };
  let renderError = null;
  for (const name of ['renderAutomationRules', 'renderWorkspace']) {
    const original = tracker[name];
    tracker[name] = function (...args) { try { return original.apply(this, args); } catch (error) { renderError = error; throw error; } };
  }
  const messages = [];
  tracker.showMessage = (message, kind) => messages.push({ message, kind });
  await tracker.submitAutomationRule();
  assert.equal(renderError, null, renderError?.stack);
  assert.equal(doc.getElementById('modal').style.display, 'none');
  assert.ok(messages.some(item => item.kind === 'success'));
  assert.match(doc.getElementById('automation-rules').textContent, /预览待补齐/);
});

test('a refresh failure after rule saving reports the saved state and prevents duplicates', async t => {
  const { tracker, doc } = fixture(t);
  tracker.assertWritable = () => {};
  tracker.showAutomationRuleModal();
  doc.getElementById('rule-name').value = '测试订阅';
  doc.getElementById('rule-category').value = '现金';
  doc.getElementById('rule-amount').value = '-10';
  doc.getElementById('rule-start-date').value = '2026-01-01';
  let writes = 0;
  tracker.persistData = async () => { writes++; };
  tracker.renderAutomationRules = () => { throw Error('render failed'); };
  const messages = [];
  tracker.showMessage = (message, kind) => messages.push({ message, kind });
  await tracker.submitAutomationRule();
  await tracker.submitAutomationRule();
  assert.equal(writes, 1);
  assert.ok(messages.some(item => /已保存/.test(item.message) && /刷新/.test(item.message)));
  assert.equal(doc.querySelector('#automation-rule-form button[type="submit"]').disabled, true);
});

test('laying out the automation page preserves classification rules as data', async t => {
  const { tracker, doc, app } = fixture(t);
  await tracker.setupWorkspace();
  tracker.ws.rules = [{ id: 'classification', match: '午餐', purpose: '餐饮美食', enabled: true }];
  app.context.innerHeight = 800;
  app.context.innerWidth = 1200;
  doc.getElementById('normal-app-shell').getBoundingClientRect = () => ({ width: 1200, top: 0 });
  doc.querySelector('.nav-link[data-section="automation"]').click();
  tracker.fitWorkspace();
  assert.ok(Array.isArray(tracker.ws.rules));
  assert.equal(tracker.ws.rules[0].id, 'classification');
  assert.doesNotThrow(() => tracker.renderWorkspace());
});

test('rule actions show a pending state until saving completes', async t => {
  const { tracker, doc } = fixture(t);
  tracker.data.automationRules = [{ id: 'r', name: '房租', category: '现金', amount: -10, frequency: 'monthly', startDate: '2026-01-01', active: true }];
  tracker.assertWritable = () => {};
  let finish;
  tracker.persistData = () => new Promise(resolve => { finish = resolve; });
  tracker.showMessage = () => {};
  tracker.renderAutomationRules();
  const pending = tracker.toggleRule('r');
  assert.ok([...doc.querySelectorAll('#automation-rules .rule-actions button')].every(button => button.disabled));
  finish();
  await pending;
  const buttons = [...doc.querySelectorAll('#automation-rules .rule-actions button')];
  assert.equal(buttons[0].disabled, false);
  assert.equal(buttons[1].disabled, true);
  assert.equal(buttons[2].disabled, false);
});

test('a paused periodic rule cannot prepare drafts and its action describes preview', t => {
  const { tracker, doc } = fixture(t);
  tracker.data.automationRules = [{ id: 'r', name: '房租', category: '现金', amount: -10, frequency: 'monthly', startDate: '2026-01-01', active: false }];
  tracker.ws = { ready: true };
  tracker.renderAutomationRules();
  const preview = doc.querySelector('#automation-rules [onclick*="fillToToday"]');
  assert.match(preview.textContent, /预览/);
  assert.equal(preview.disabled, true);
});

test('legacy catch-up cannot directly write bills without explaining the balance change', async t => {
  let prompt = '';
  const { tracker } = fixture(t, message => { prompt = message; return false; });
  tracker.data.automationRules = [{ id: 'r', name: '房租', category: '现金', amount: -10, frequency: 'monthly', startDate: '2020-01-01', active: true }];
  tracker.getMissingTransactions = () => [{ id: 'new', amount: -10 }];
  let writes = 0;
  tracker.persistData = async () => { writes++; };
  tracker.showMessage = () => {};
  await tracker.fillToToday('r');
  assert.match(prompt, /直接|立即/);
  assert.match(prompt, /余额/);
  assert.equal(writes, 0);
  assert.equal(tracker.data.transactions.length, 0);
});

test('deleting an initial asset requires confirmation that identifies the analysis impact', async t => {
  let prompt = '';
  const { tracker } = fixture(t, message => { prompt = message; return false; });
  tracker.data.initialAssets = [{ id: 'a', category: '现金', amount: 100, currency: 'CNY', time: '2026-01-01T00:00' }];
  let writes = 0;
  tracker.persistData = async () => { writes++; };
  await tracker.deleteInitialAsset('a');
  assert.match(prompt, /历史|分析/);
  assert.equal(tracker.data.initialAssets.length, 1);
  assert.equal(writes, 0);
});

test('deleting a transaction reverses the exact account and currency after confirmation', async t => {
  let prompt = '';
  const { tracker } = fixture(t, message => { prompt = message; return true; });
  tracker.data.categories = { bank: { id: 'bank', name: '银行', children: {
    a: { id: 'a', name: '同名', balance: 100, currency: 'CNY' },
    b: { id: 'b', name: '同名', balance: 15, currency: 'USD', isDebt: true }
  } } };
  tracker.data.transactions = [{ id: 't', category: '银行', subcategory: '同名', accountId: 'b', amount: -5, currency: 'USD', date: '2026-01-01', description: '午餐' }];
  tracker.assertWritable = () => {};
  let finish;
  tracker.persistData = () => new Promise(resolve => { finish = resolve; });
  tracker.renderTransactions = tracker.renderCategories = tracker.updateDashboard = () => {};
  const messages = [];
  tracker.showMessage = (message, kind) => messages.push({ message, kind });
  const saving = tracker.deleteTransaction('t');
  assert.match(prompt, /余额/);
  assert.equal(tracker.data.categories.bank.children.a.balance, 100);
  assert.equal(tracker.data.categories.bank.children.b.balance, 10);
  assert.equal(messages.some(item => item.kind === 'success'), false);
  finish();
  await saving;
  assert.equal(tracker.data.transactions.length, 0);
  assert.equal(messages.some(item => item.kind === 'success'), true);
});

test('cross-currency deletion warns that the current rate can change the balance reversal', async t => {
  let prompt = '';
  const { tracker } = fixture(t, message => { prompt = message; return false; });
  tracker.data.categories = { cash: { id: 'cash', name: '现金', balance: 100, currency: 'CNY' } };
  tracker.data.transactions = [{ id: 't', category: '现金', accountId: 'cash', amount: -5, currency: 'USD', date: '2026-01-01' }];
  let writes = 0;
  tracker.persistData = async () => { writes++; };
  await tracker.deleteTransaction('t');
  assert.match(prompt, /当前.*汇率/);
  assert.match(prompt, /余额/);
  assert.equal(writes, 0);
  assert.equal(tracker.data.categories.cash.balance, 100);
});

test('cross-currency deletion refuses an unavailable exchange rate before altering the ledger', async t => {
  const { tracker } = fixture(t);
  tracker.data.categories = { cash: { id: 'cash', name: '现金', balance: 100, currency: 'CNY' } };
  tracker.data.settings.exchangeRates = {};
  tracker.data.transactions = [{ id: 't', category: '现金', accountId: 'cash', amount: -5, currency: 'USD', date: '2026-01-01' }];
  tracker.assertWritable = () => {};
  let writes = 0, message = '';
  tracker.persistData = async () => { writes++; };
  tracker.showMessage = text => { message = text; };
  await tracker.deleteTransaction('t');
  assert.equal(writes, 0);
  assert.equal(tracker.data.transactions.length, 1);
  assert.equal(tracker.data.categories.cash.balance, 100);
  assert.match(message, /汇率/);
});

test('deleting an imported historical bill leaves balance unchanged even without exchange rates', async t => {
  let prompt = '';
  const { tracker } = fixture(t, message => { prompt = message; return true; });
  tracker.data.categories = { cash: { id: 'cash', name: '现金', balance: 100, currency: 'CNY' } };
  tracker.data.settings.exchangeRates = {};
  tracker.data.transactions = [{ id: 't', category: '现金', accountId: 'cash', amount: -5, currency: 'USD', date: '2026-01-01', wechat: { balanceMode: 'history' } }];
  tracker.assertWritable = () => {};
  tracker.persistData = async () => {};
  tracker.renderTransactions = tracker.renderCategories = tracker.updateDashboard = () => {};
  tracker.showMessage = () => {};
  await tracker.deleteTransaction('t');
  assert.match(prompt, /历史.*余额/);
  assert.equal(tracker.data.categories.cash.balance, 100);
  assert.equal(tracker.data.transactions.length, 0);
});

test('analysis methodology is available by disclosure while live warnings remain visible', t => {
  const { tracker, doc } = fixture(t);
  tracker.drawAnalysisChart = () => {};
  tracker.updateAnalyticsOptions();
  tracker.generateAnalytics();
  const explanation = doc.querySelector('#analytics-output .analysis-card .ui-info');
  assert.ok(explanation);
  assert.equal(explanation.open, false);
  assert.match(explanation.querySelector('summary').getAttribute('aria-label'), /说明|口径/);
  explanation.open = true;
  assert.match(explanation.textContent, /负债/);
  assert.match(doc.getElementById('analytics-warnings').textContent, /当前设置汇率/);
  tracker.analyticsView = 'forecast';
  tracker.generateAnalytics();
  assert.match(doc.querySelector('#analytics-output .analysis-caution').textContent, /不代表实际收益/);
});

test('a focused wide analysis table can be scrolled with the keyboard', t => {
  const { tracker, doc } = fixture(t);
  tracker.drawAnalysisChart = () => {};
  tracker.setupEventListeners();
  tracker.updateAnalyticsOptions();
  tracker.generateAnalytics();
  const area = doc.querySelector('#analytics-output .analysis-table');
  Object.defineProperty(area, 'scrollWidth', { value: 470 });
  Object.defineProperty(area, 'clientWidth', { value: 300 });
  const right = new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowRight', bubbles: true, cancelable: true });
  area.dispatchEvent(right);
  assert.ok(area.scrollLeft > 0);
  assert.equal(right.defaultPrevented, true);
  area.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown', { key: 'ArrowLeft', bubbles: true, cancelable: true }));
  assert.equal(area.scrollLeft, 0);
});

test('uncertain deletion does not report success or issue a second write', async t => {
  const { tracker } = fixture(t);
  tracker.data.automationRules = [{ id: 'r', name: '房租', category: '现金', amount: -10, frequency: 'monthly', startDate: '2026-01-01', active: true }];
  tracker.assertWritable = () => {};
  let writes = 0;
  tracker.persistData = async () => { writes++; throw Error('save outcome unknown'); };
  const messages = [];
  tracker.showMessage = (message, kind) => messages.push({ message, kind });
  await tracker.deleteRule('r');
  await tracker.deleteRule('r');
  assert.equal(writes, 1);
  assert.ok(messages.some(item => /未确认/.test(item.message)));
  assert.equal(messages.some(item => item.kind === 'success'), false);
});
