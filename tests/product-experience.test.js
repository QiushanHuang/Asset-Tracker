const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const { JSDOM } = require('../app/node_modules/jsdom');
const { loadAssetTracker } = require('./helpers/asset-tracker-harness');

function fixture(t) {
    const dom = new JSDOM(fs.readFileSync(require.resolve('../index.html'), 'utf8'));
    // These focused tests invoke the controller explicitly, without the production auto-boot.
    const listen = dom.window.document.addEventListener.bind(dom.window.document);
    dom.window.document.addEventListener = (name, ...args) => {
        if (name !== 'DOMContentLoaded') listen(name, ...args);
    };
    const app = loadAssetTracker({ document: dom.window.document });
    const tracker = new app.AssetTracker();
    tracker.data = tracker.getDefaultState();
    t.after(() => { app.dispose(); dom.window.close(); });
    return { tracker, doc: dom.window.document, dom, app };
}
const transaction = (id, date, extra = {}) => ({ id, date, amount: -10, currency: 'CNY', category: '现金', subcategory: '', type: '单次', purpose: '餐饮美食', description: '午餐', ...extra });

test('large ledgers render at most 50 rows and can reach every page', t => {
    const { tracker, doc } = fixture(t);
    tracker.data.transactions = Array.from({length: 121}, (_, i) => transaction(String(i), '2026-09-18'));
    tracker.renderTransactions();
    assert.equal(doc.querySelectorAll('#transactions-tbody tr').length, 50);
    tracker.changeTransactionPage(1);
    assert.equal(doc.querySelectorAll('#transactions-tbody tr').length, 50);
    tracker.changeTransactionPage(1);
    assert.equal(doc.querySelectorAll('#transactions-tbody tr').length, 21);
    assert.match(doc.getElementById('transaction-count').textContent, /121/);
    assert.equal(doc.getElementById('next-transactions').disabled, true);
});

test('search treats markup as literal text, combines filters, and resets pagination', t => {
    const { tracker, doc } = fixture(t);
    tracker.data.transactions = [transaction('a', '2026-09-18', {description:'<img src=x onerror=alert(1)>'}), transaction('b', '2026-09-17')];
    doc.getElementById('transaction-search').value = '<img';
    tracker.transactionPage = 10;
    tracker.filterTransactions();
    assert.equal(doc.querySelectorAll('#transactions-tbody tr').length, 1);
    assert.equal(doc.querySelector('#transactions-tbody img'), null);
    assert.match(doc.getElementById('transactions-tbody').textContent, /<img/);
    assert.equal(tracker.transactionPage, 0);
});

test('empty and invalid date ranges explain how to recover', t => {
    const { tracker, doc } = fixture(t);
    tracker.renderTransactions();
    assert.match(doc.getElementById('transactions-tbody').textContent, /暂无账单/);
    tracker.data.transactions = [transaction('a', '2026-09-18')];
    doc.getElementById('date-from').value = '2026-09-20';
    doc.getElementById('date-to').value = '2026-09-10';
    tracker.filterTransactions();
    assert.match(doc.getElementById('transactions-tbody').textContent, /开始日期不能晚于结束日期/);
});

test('recent transactions follow business date and preserve original currency', t => {
    const { tracker, doc } = fixture(t);
    tracker.data.transactions = [transaction('new', '2026-09-18', {currency:'USD',description:'最新'}), transaction('old', '2020-01-01', {description:'补录'})];
    tracker.updateRecentTransactions();
    const first = doc.querySelector('#recent-transactions-list .transaction-item');
    assert.match(first.textContent, /最新/);
    assert.match(first.textContent, /USD/);
});

test('memo, category names, and descriptions stay inert in display and edit forms', t => {
    const { tracker, doc } = fixture(t);
    const attack = '</textarea><img src=x onerror="alert(1)">';
    tracker.data.memo = attack;
    tracker.renderMemo();
    assert.equal(doc.querySelector('#memo-content img'), null);
    assert.equal(doc.querySelector('#memo-content .memo-text').textContent, attack);
    tracker.editMemo();
    assert.equal(doc.querySelector('#modal-body img'), null);
    assert.equal(doc.getElementById('memo-text').value, attack);
    tracker.data.categories = { cash: {id:'cash', name:attack, balance:0, currency:'CNY'} };
    tracker.renderCategories();
    assert.equal(doc.querySelector('#categories-tree img'), null);
    tracker.showTransactionModal();
    assert.equal(doc.querySelector('#modal-body img'), null);
    assert.equal(doc.querySelector('#transaction-category option:last-child').textContent, attack);
});

test('imported identifiers cannot escape an inline handler', t => {
    const { tracker, doc } = fixture(t);
    tracker.data.categories = { cash: {id:"x');alert(1);//", name:'Cash', balance:0, currency:'CNY'} };
    tracker.renderCategories();
    const handler = doc.querySelector('.category-header').getAttribute('onclick');
    let received;
    new Function('window', handler)({ assetTracker: {toggleCategoryCollapse(id) {received=id;} } });
    assert.equal(received, "x');alert(1);//");
});

test('dialog receives focus, traps tab, closes on escape, and restores focus', t => {
    const { tracker, doc, dom } = fixture(t);
    tracker.setupEventListeners();
    doc.getElementById('normal-app-shell').inert = false;
    doc.getElementById('normal-app-shell').hidden = false;
    const trigger = doc.getElementById('add-transaction-btn');
    trigger.focus();
    tracker.showTransactionModal();
    assert.equal(doc.getElementById('modal').getAttribute('role'), 'dialog');
    assert.equal(doc.getElementById('normal-app-shell').inert, true);
    assert.ok(doc.getElementById('modal').contains(doc.activeElement));
    const lastControl = doc.getElementById('save-and-continue');
    lastControl.focus();
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Tab', bubbles:true, cancelable:true}));
    assert.equal(doc.activeElement, doc.querySelector('.close'));
    doc.dispatchEvent(new dom.window.KeyboardEvent('keydown', {key:'Escape', bubbles:true}));
    assert.equal(doc.getElementById('modal').style.display, 'none');
    assert.equal(doc.activeElement, trigger);
    assert.equal(doc.getElementById('normal-app-shell').inert, false);
});

test('net assets subtract debt and recognize liability overpayments in dashboard and history', t => {
    const { tracker } = fixture(t);
    tracker.data.categories = {a:{id:'cash',name:'Cash',balance:100,currency:'CNY'}, b:{id:'debt',name:'Debt',balance:30,currency:'CNY',isDebt:true}, c:{id:'credit',name:'Credit',balance:-5,currency:'CNY',isDebt:true}};
    assert.equal(tracker.calculateTotals().totalAssets, 75);
    assert.equal(tracker.calculateTotals().totalDebt, 30);
    assert.equal(tracker.calculateTotals().debtCredit, 5);
    assert.equal(tracker.calculateDailyAssetBalance([]).totalAssets, 75);
    assert.equal(tracker.calculateAssetBreakdown('total').CNY, 75);
});

test('analysis uses actual daily signed movements rather than random balances', t => {
    const { tracker } = fixture(t);
    const now = new Date();
    const day = `${now.getFullYear()}-${String(now.getMonth()+1).padStart(2,'0')}-${String(now.getDate()).padStart(2,'0')}`;
    tracker.data.transactions = [transaction('a', day, {amount:20}), transaction('b', day, {amount:-3, currency:'USD'}), transaction('c', day, {amount:999,category:'别的账户'})];
    const result = tracker.prepareChartData(['现金'], 7);
    assert.equal(result.labels.length, 7);
    assert.ok(Math.abs(result.datasets[0].data.at(-1) - (20 - 3*7.2)) < 1e-9);
    assert.deepEqual(Array.from(result.datasets[0].data.slice(0,-1)), [0,0,0,0,0,0]);
});

test('initial filter matches rendered results and does not reset on refresh', t => {
    const { tracker, doc } = fixture(t);
    tracker.initializeTransactionFilters();
    doc.getElementById('date-from').value = '2020-01-01';
    tracker.initializeTransactionFilters();
    assert.equal(doc.getElementById('date-from').value, '2020-01-01');
});

test('nested category labels remain inert in parent selection', t => {
    const { tracker, doc } = fixture(t);
    tracker.data.categories = {a:{id:'a',name:'<img src=x onerror=alert(1)>',children:{b:{id:'b',name:'Leaf',balance:0,currency:'CNY'}}}};
    tracker.showCategoryModal();
    assert.equal(doc.querySelector('#modal-body img'), null);
    assert.ok(doc.querySelector('#modal-body').textContent.includes('<img'));
});

test('category totals use the same net asset and overpayment definition as dashboard', t => {
    const {tracker} = fixture(t);
    const category = {id:'group',name:'Group',children:{a:{id:'cash',name:'Cash',balance:100,currency:'CNY'},b:{id:'debt',name:'Debt',balance:30,currency:'CNY',isDebt:true}}};
    tracker.data.categories = {category};
    const summary = tracker.calculateCategorySummary(category);
    assert.equal(summary.totalAssets,70);
    assert.equal(summary.currentBalance,100);
    assert.equal(summary.baseCurrencyTotal,70);
});

test('recording a transaction reports success only after durable save resolves and rejects double submit', async t => {
    const {tracker,doc} = fixture(t);
    tracker.showTransactionModal();
    doc.getElementById('transaction-category').value='现金';
    doc.getElementById('transaction-amount').value='-5';
    doc.getElementById('transaction-purpose').value='餐饮美食';
    let resolve;
    tracker.persistData = () => new Promise(r=>{resolve=r;});
    tracker.renderTransactions = tracker.updateDashboard = ()=>{};
    const messages=[];
    tracker.showMessage=(text,type)=>messages.push({text,type});
    const first=tracker.submitTransaction();
    await tracker.submitTransaction();
    assert.equal(messages.length,0);
    assert.equal(tracker.data.transactions.length,1);
    assert.equal(doc.getElementById('modal').style.display,'block');
    resolve(); await first;
    assert.equal(messages.length,1);
    assert.equal(messages[0].type,'success');
    assert.equal(doc.getElementById('modal').style.display,'none');
});

test('a failed transaction save keeps the form and never claims success', async t => {
    const {tracker,doc} = fixture(t);
    tracker.showTransactionModal();
    doc.getElementById('transaction-category').value='现金';
    doc.getElementById('transaction-amount').value='-5';
    doc.getElementById('transaction-purpose').value='餐饮美食';
    tracker.persistData=()=>Promise.reject(new Error('disk full'));
    tracker.renderTransactions=tracker.updateDashboard=()=>{};
    const messages=[]; tracker.showMessage=(text,type)=>messages.push({text,type});
    await tracker.submitTransaction();
    assert.equal(doc.getElementById('modal').style.display,'block');
    assert.equal(messages.filter(m=>m.type==='success').length,0);
    assert.equal(doc.getElementById('transaction-amount').value,'-5');
    assert.equal(doc.querySelector('#transaction-form button[type=submit]').disabled,true);
});

test('a parent category cannot be dragged into its own descendant', t => {
    const {tracker} = fixture(t);
    const child = {id:'child',name:'Child',balance:0,currency:'CNY'};
    const parent = {id:'parent',name:'Parent',children:{child}};
    tracker.data.categories={parent};
    let moved=false;
    tracker.moveCategoryOrder=()=>{moved=true;};
    tracker.handleCategoryDrop(parent, child, {getBoundingClientRect:()=>({top:0,height:40})}, {clientY:10});
    assert.equal(moved,false);
});

test('bulk rule catch-up saves and redraws once with unique transaction identities', async t => {
    const {tracker}=fixture(t);
    tracker.data.automationRules=[{id:'rule',active:true,startDate:'2020-01-01'}];
    tracker.getMissingTransactions=()=>[transaction(null,'2020-01-01'),transaction(null,'2020-01-02'),transaction(null,'2020-01-03')];
    let saves=0,renders=0;
    tracker.persistData=async()=>{saves++;};
    tracker.renderTransactions=()=>{renders++;}; tracker.updateDashboard=()=>{};
    await tracker.fillToToday('rule');
    assert.equal(saves,1);
    assert.equal(renders,1);
    assert.equal(new Set(tracker.data.transactions.map(t=>t.id)).size,3);
});

test('editing a transaction waits for confirmed persistence and keeps the dialog on failure', async t => {
    const {tracker,doc}=fixture(t);
    tracker.data.transactions=[transaction('edit','2026-09-18',{subcategory:'人民币'})];
    tracker.editTransaction('edit');
    doc.getElementById('edit-transaction-amount').value='-8';
    let reject;
    tracker.persistData=()=>new Promise((_,r)=>{reject=r;});
    tracker.renderTransactions=tracker.renderCategories=tracker.updateDashboard=()=>{};
    const messages=[]; tracker.showMessage=(text,type)=>messages.push(type);
    const pending=tracker.updateTransaction('edit');
    assert.equal(messages.length,0);
    assert.equal(doc.getElementById('modal').style.display,'block');
    reject(new Error('unconfirmed')); await pending;
    assert.equal(messages.includes('success'),false);
    assert.equal(doc.querySelector('#edit-transaction-form button[type=submit]').disabled,true);
});

test('spreadsheet import opens a review and writes only after a durable confirmation', async t => {
 const {tracker,doc,app}=fixture(t);const before=JSON.stringify(tracker.data);let saves=0;
 app.context.XLSX={read:()=>({SheetNames:['sheet'],Sheets:{sheet:{}}}),utils:{sheet_to_json:()=>[{'日期':'2026-09-19','类别':'现金','子类别':'人民币','金额':-10}]}};
 tracker.fileAdapter.openImport=async()=>({text:'fixture'});tracker.fileAdapter.normalizeImportedContent=x=>x;
 tracker.assertWritable=()=>{};tracker.saveData=async()=>{saves++;};tracker.refreshDataViews=()=>{};
 await tracker.importData();assert.equal(JSON.stringify(tracker.data),before);assert.equal(saves,0);
 assert.match(doc.getElementById('modal-body').textContent,/预览/);
 await tracker.commitImportPreview();assert.equal(saves,1);assert.equal(tracker.data.transactions.length,1);
});
test('import preview becomes stale instead of overwriting another edit', async t=>{
 const {tracker,doc,app}=fixture(t);app.context.XLSX={read:()=>({SheetNames:['s'],Sheets:{s:{}}}),utils:{sheet_to_json:()=>[{'日期':'2026-09-19','类别':'现金','子类别':'人民币','金额':-10}]}};
 tracker.fileAdapter.openImport=async()=>({text:'fixture'});tracker.fileAdapter.normalizeImportedContent=x=>x;tracker.assertWritable=()=>{};
 let saves=0;tracker.saveData=async()=>saves++;await tracker.importData();tracker.data.memo='new edit';await tracker.commitImportPreview();assert.equal(saves,0);assert.equal(tracker.data.memo,'new edit');assert.match(doc.getElementById('import-preview-status').textContent,/变化/);
});
test('pagination does not recompute hidden project summaries',t=>{const {tracker}=fixture(t);let calls=0;tracker.renderProjectWorkspace=()=>calls++;tracker.changeTransactionPage(1);assert.equal(calls,0);});
test('cancelling the browser file chooser resolves instead of locking future imports', {timeout:500}, async t=>{const {tracker,doc,dom}=fixture(t);const input=doc.getElementById('import-file');input.click=()=>{};const p=tracker.fileAdapter.openImport({fileInputId:'import-file'});input.dispatchEvent(new dom.window.Event('cancel'));assert.equal(await p,null);});
test('JSON replacement backs up before mutation; a cancelled backup leaves the active ledger intact',async t=>{const {tracker}=fixture(t);tracker.assertWritable=()=>{};const before=JSON.stringify(tracker.data);tracker.fileAdapter.openImport=async()=>({text:JSON.stringify({...tracker.data,memo:'replacement'})});tracker.fileAdapter.normalizeImportedContent=x=>x;tracker.fileAdapter.saveFile=async()=>{assert.equal(JSON.stringify(tracker.data),before);throw Error('用户取消了操作');};let saves=0;tracker.saveData=async()=>saves++;tracker.refreshDataViews=()=>{};await tracker.importFullBook();assert.equal(saves,0);assert.equal(JSON.stringify(tracker.data),before);});
test('a failed file read cannot roll back unrelated changes made during the picker',async t=>{const {tracker}=fixture(t);tracker.assertWritable=()=>{};tracker.fileAdapter.openImport=async()=>{tracker.data.memo='newer edit';throw Error('bad file');};tracker.refreshDataViews=()=>{};await tracker.importFullBook();assert.equal(tracker.data.memo,'newer edit');});
test('NAS navigation hides local ledger quick actions and local project context',t=>{const {tracker,doc,dom}=fixture(t);tracker.setupNavigation();doc.querySelector('[data-section="nas"]').dispatchEvent(new dom.window.MouseEvent('click',{bubbles:true,cancelable:true}));assert.equal(doc.querySelector('.header-right').hidden,true);assert.equal(doc.getElementById('active-project-status').hidden,true);doc.querySelector('[data-section="transactions"]').click();assert.equal(doc.querySelector('.header-right').hidden,false);});
test('browser binary imports are not decoded as base64; UTF-8 CSV and native base64 converge',t=>{const {tracker}=fixture(t);const text='日期,金额\n2026-09-19,-10\n';const binary=Buffer.from(text,'utf8').toString('latin1');assert.equal(tracker.fileAdapter.normalizeImportedContent(binary,'binary',{output:'binary'}),binary);assert.equal(tracker.fileAdapter.normalizeImportedContent(binary,'binary',{output:'text'}),text);assert.equal(tracker.fileAdapter.normalizeImportedContent(Buffer.from(text,'utf8').toString('base64'),'base64',{output:'binary'}),binary);});
test('real UTF-8 CSV parser produces a valid preview with Chinese account names',async t=>{const {tracker,app,doc}=fixture(t);app.context.XLSX=require('../vendor/xlsx.full.min.js');tracker.assertWritable=()=>{};tracker.fileAdapter.openImport=async()=>({text:Buffer.from('日期,类别,子类别,金额,货币类型,描述\n2026-09-19,现金,人民币,-25.5,CNY,午餐\n','utf8').toString('latin1'),encoding:'binary'});await tracker.importData();assert.equal(tracker.importPreview.errors.length,0);assert.equal(tracker.importPreview.accepted[0].transaction.description,'午餐');assert.match(doc.getElementById('modal-body').textContent,/可新增/);});
