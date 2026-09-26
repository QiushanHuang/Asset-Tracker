const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('../app/node_modules/jsdom');
const {loadAssetTracker} = require('./helpers/asset-tracker-harness');

function fixture(t) {
  const dom = new JSDOM(fs.readFileSync(require.resolve('../index.html'),'utf8'),{url:'http://localhost'});
  const listen = dom.window.document.addEventListener.bind(dom.window.document);
  dom.window.document.addEventListener = (name,...args) => { if(name !== 'DOMContentLoaded') listen(name,...args); };
  const app = loadAssetTracker({document:dom.window.document,lockManager:{request:async(_name,callback)=>callback()}});
  app.context.URL = dom.window.URL;
  app.context.AbortController = AbortController;
  app.context.innerWidth = 1200;
  app.context.innerHeight = 900;
  const tracker = new app.AssetTracker();
  tracker.data = tracker.getDefaultState();
  tracker.setupNavigation();
  t.after(()=>{ app.dispose(); dom.window.close(); });
  return {tracker,doc:dom.window.document,app};
}

// JSDOM has no layout engine; the tests supply viewport measurements, never application results.
function dashboardGeometry(doc,{height=300,width=1000}={}) {
  const section = doc.getElementById('dashboard'), grid = section.querySelector('.workspace-grid');
  Object.defineProperty(section,'clientHeight',{get:()=>height,configurable:true});
  Object.defineProperty(grid,'clientWidth',{get:()=>width,configurable:true});
  doc.getElementById('normal-app-shell').getBoundingClientRect = ()=>({width:1200,top:0,height:900,bottom:900});
  return section;
}

test('dashboard paging retains keyboard focus and exposes every enabled module exactly once',async t=>{
  const {tracker,doc} = fixture(t);
  await tracker.setupWorkspace();
  tracker.ws.prefs.modules.forEach(module=>module.visible=true);
  tracker.applyWorkspacePreferences(tracker.ws.prefs);
  const section = dashboardGeometry(doc);
  tracker.fitWorkspaceDashboard(section);
  const pages = tracker.ws.dashboardPlan.pages.length, seen = [];
  assert.ok(pages>=3);
  const pager = doc.getElementById('workspace-home-pages'), next = pager.querySelectorAll('button')[1];
  for(let page=0;page<pages;page++) {
    assert.equal(tracker.ws.dashboardPage,page);
    assert.equal(pager.querySelector('span').textContent,`${page+1} / ${pages}`);
    const visible = [...section.querySelectorAll('[data-ws-module]')].filter(node=>!node.hidden&&!node.classList.contains('ws-off-page'));
    seen.push(...visible.map(node=>node.dataset.wsModule));
    assert.equal(next.disabled,page===pages-1);
    if(page<pages-1) {
      next.focus(); next.click(); tracker.fitWorkspaceDashboard(section);
      assert.equal(pager.querySelectorAll('button')[1],next);
      assert.equal(next.isConnected,true);
      if(page<pages-2) assert.equal(doc.activeElement,next);
    }
  }
  assert.deepEqual(seen,Array.from(tracker.ws.prefs.modules,module=>module.id));
  assert.equal(new Set(seen).size,seen.length);
});

test('keyboard assistant shortcut selects its dashboard page before focusing the input',async t=>{
  const {tracker,doc} = fixture(t);
  await tracker.setupWorkspace();
  const section = dashboardGeometry(doc);
  tracker.fitWorkspaceDashboard(section);
  const assistant = doc.getElementById('workspace-assistant'), input = doc.getElementById('workspace-agent-input');
  assert.equal(assistant.classList.contains('ws-off-page'),true);
  doc.dispatchEvent(new doc.defaultView.KeyboardEvent('keydown',{key:'k',ctrlKey:true,bubbles:true}));
  assert.equal(section.classList.contains('active'),true);
  assert.ok(tracker.ws.dashboardPage>0);
  assert.equal(assistant.classList.contains('ws-off-page'),false);
  assert.equal(doc.activeElement,input);
  tracker.fitWorkspaceDashboard(section);
  assert.equal(assistant.classList.contains('ws-off-page'),false);
  assert.equal(doc.activeElement,input);
});

test('an active assistant remains visible when its status forces dashboard pagination',async t=>{
  const {tracker,doc} = fixture(t);
  await tracker.setupWorkspace();
  const section = dashboardGeometry(doc,{height:470});
  tracker.fitWorkspaceDashboard(section);
  assert.equal(tracker.ws.dashboardPlan.pages.length,1);
  const assistant = doc.getElementById('workspace-assistant'), input = doc.getElementById('workspace-agent-input');
  input.focus(); input.value='午餐32元';
  tracker.ws.connection = {...tracker.ws.connection,enabled:true,allowText:true,model:'synthetic-model'};
  let reject;
  tracker.workspaceModelTransport = ()=>new Promise((_resolve,rejectPromise)=>{reject=rejectPromise;});
  const before = JSON.stringify(tracker.data), run = tracker.runWorkspaceAgent(input.value);
  try {
    tracker.fitWorkspaceDashboard(section);
    assert.ok(tracker.ws.dashboardPlan.pages.length>1);
    assert.ok(tracker.ws.runActiveId);
    assert.equal(assistant.classList.contains('ws-off-page'),false);
    assert.equal(doc.getElementById('workspace-agent-cancel').hidden,false);
    assert.equal(doc.activeElement,input);
  } finally {
    reject(Error('synthetic cancelled request'));
    await run;
  }
  assert.equal(JSON.stringify(tracker.data),before);
});

test('mobile review detail does not repaginate its hidden list or discard typed draft edits',async t=>{
  const {tracker,doc,app} = fixture(t);
  app.context.innerWidth=390;
  await tracker.setupWorkspace();
  const section = doc.getElementById('workspace-review'), list = doc.getElementById('workspace-review-list'), main = list.parentElement;
  section.getBoundingClientRect = ()=>({bottom:800});
  main.getBoundingClientRect = ()=>({height:section.dataset.pane==='detail'?0:600});
  list.getBoundingClientRect = ()=>({top:section.dataset.pane==='detail'?0:300});
  tracker.ws.drafts = Array.from({length:100},(_,index)=>({id:'draft-'+index,status:'pending',source:'manual',proposal:{date:'2026-09-26',amount:'32',direction:'expense',currency:'CNY',accountId:'cash-cny',purpose:'餐饮美食',description:'row '+index,projectId:'',expenseCategoryId:''}}));
  const before = JSON.stringify(tracker.data);
  tracker.ws.focusId='draft-0'; tracker.ws.reviewPane='list'; tracker.renderWorkspaceReview();
  tracker.fitWorkspaceReview(section);
  tracker.ws.reviewPage=10; tracker.fitWorkspaceReview(section);
  tracker.workspaceAction('select-draft',{dataset:{id:'draft-70'}});
  tracker.fitWorkspaceReview(section);
  assert.equal(tracker.ws.reviewPage,10);
  const amount = doc.getElementById('ws-draft-amount');
  amount.value='45.50'; amount.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));
  tracker.workspaceAction('review-list',{});
  tracker.fitWorkspaceReview(section);
  assert.equal(tracker.ws.reviewPage,10);
  assert.equal(list.querySelector('.selected').hidden,false);
  assert.equal(doc.getElementById('ws-draft-amount').value,'45.50');
  assert.equal(JSON.stringify(tracker.data),before);
});

test('adaptive transaction pages retain their anchor and cover every filtered row exactly once',async t=>{
  const {tracker,doc} = fixture(t);
  await tracker.setupWorkspace();
  tracker.data.transactions=Array.from({length:37},(_,index)=>({id:'transaction-'+index,date:'2026-09-26',accountId:'cash-cny',category:'现金',subcategory:'人民币',amount:-index-1,currency:'CNY',type:'单次',purpose:'其他',description:'row '+index}));
  for(const id of ['date-from','date-to','category-filter','project-filter','transaction-search']) doc.getElementById(id).value='';
  const section = doc.getElementById('transactions'), table = doc.getElementById('transactions-table'), footer = section.querySelector('.table-footer');
  let bottom=666;
  section.getBoundingClientRect=()=>({bottom}); table.getBoundingClientRect=()=>({top:200}); footer.getBoundingClientRect=()=>({height:34});
  const rowIDs = ()=>[...doc.querySelectorAll('#transactions-tbody [data-edit-transaction]')].map(button=>button.dataset.editTransaction);
  function assertCoverage() {
    const size=tracker.ws.transactionPageSize, pages=Math.ceil(37/size), seen=[];
    tracker.transactionPage=0; tracker.renderTransactions();
    for(let page=0;page<pages;page++) {
      const current=rowIDs(); seen.push(...current);
      assert.equal(current.length,Math.min(size,37-page*size));
      const counts=doc.getElementById('transaction-count').textContent.match(/共 (\d+) 笔.*?(\d+)–(\d+) 笔/);
      assert.ok(counts);assert.deepEqual(counts.slice(1).map(Number),[37,page*size+1,Math.min((page+1)*size,37)]);
      assert.equal(doc.getElementById('previous-transactions').disabled,page===0);
      assert.equal(doc.getElementById('next-transactions').disabled,page===pages-1);
      if(page<pages-1) tracker.changeTransactionPage(1);
    }
    assert.deepEqual(seen,tracker.data.transactions.map(transaction=>transaction.id));
  }
  tracker.renderTransactions(); tracker.fitWorkspaceTransactions(section);
  assert.equal(tracker.ws.transactionPageSize,7); assertCoverage();
  tracker.transactionPage=3; tracker.renderTransactions(); const anchor=rowIDs()[0];
  bottom=510; tracker.fitWorkspaceTransactions(section);
  assert.equal(tracker.ws.transactionPageSize,4); assert.ok(rowIDs().includes(anchor)); assertCoverage();
  doc.getElementById('transaction-search').value='no matching synthetic transaction'; tracker.filterTransactions();
  assert.equal(rowIDs().length,0); assert.equal(tracker.transactionPage,0);
  assert.match(doc.getElementById('transaction-count').textContent,/共 0 笔.*0–0 笔/);
  assert.equal(doc.getElementById('previous-transactions').disabled,true);
  assert.equal(doc.getElementById('next-transactions').disabled,true);
});

test('compact connection groups preserve typed settings and keyboard focus across fits',async t=>{
  const {tracker,doc} = fixture(t);
  await tracker.setupWorkspace();
  const before=JSON.stringify(tracker.data);
  tracker.ws.settingsTab='connection'; tracker.renderWorkspaceSettings(); tracker.fitWorkspaceSettings();
  const panel=doc.getElementById('workspace-connection-settings'), buttons=panel.querySelectorAll('.ws-compact-tabs button');
  const url=doc.getElementById('ws-provider-url'), key=doc.getElementById('ws-provider-key'), model=doc.getElementById('ws-provider-model');
  url.value='http://127.0.0.1:1234/v1'; key.value='synthetic-session-key'; model.value='draft-model-name';
  for(const index of [1,0]) {
    buttons[index].focus(); buttons[index].click(); tracker.fitWorkspaceSettings();
    assert.equal(panel.dataset.part,String(index)); assert.equal(doc.activeElement,buttons[index]);
    assert.equal(panel.querySelectorAll('.ws-compact-tabs button')[index],buttons[index]);
    assert.equal(url.value,'http://127.0.0.1:1234/v1'); assert.equal(key.value,'synthetic-session-key'); assert.equal(model.value,'draft-model-name');
  }
  model.focus(); model.setSelectionRange(2,6); tracker.fitWorkspaceSettings();
  assert.equal(doc.activeElement,model); assert.equal(model.selectionStart,2); assert.equal(model.selectionEnd,6);
  assert.equal(JSON.stringify(tracker.data),before); assert.equal(tracker.ws.connection.model,'');
});

test('book settings panels retain unsaved values when switching between their cards',async t=>{
  const {tracker,doc} = fixture(t);
  await tracker.setupWorkspace();
  const before=JSON.stringify(tracker.data), section=doc.getElementById('settings'), cards=[...section.querySelectorAll('.settings-container>.card')];
  tracker.workspacePanels(section,cards,'bookSettings');
  const buttons=section.querySelectorAll('[data-panel-tabs="bookSettings"] button');
  const currency=doc.getElementById('base-currency'), interval=doc.getElementById('backup-interval'), amount=doc.getElementById('init-asset-amount');
  currency.value='USD'; interval.value='72'; amount.value='1234.50';
  for(const index of [1,2,0]) {
    buttons[index].focus(); buttons[index].click(); tracker.workspacePanels(section,cards,'bookSettings');
    assert.equal(cards[index].classList.contains('ws-panel-current'),true); assert.equal(doc.activeElement,buttons[index]);
    assert.equal(currency.value,'USD'); assert.equal(interval.value,'72'); assert.equal(amount.value,'1234.50');
  }
  assert.equal(JSON.stringify(tracker.data),before);
});
