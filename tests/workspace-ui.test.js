const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('../app/node_modules/jsdom');const {loadAssetTracker}=require('./helpers/asset-tracker-harness');
function fixture(t,extra={}){const dom=new JSDOM(fs.readFileSync(require.resolve('../index.html'),'utf8'),{url:'http://localhost'});const listen=dom.window.document.addEventListener.bind(dom.window.document);dom.window.document.addEventListener=(name,...args)=>{if(name!=='DOMContentLoaded')listen(name,...args);};const app=loadAssetTracker({document:dom.window.document,lockManager:{request:async(_name,callback)=>callback()},...extra});app.context.URL=dom.window.URL;app.context.AbortController=AbortController;const tracker=new app.AssetTracker();tracker.data=tracker.getDefaultState();tracker.setupNavigation();t.after(()=>{app.dispose();dom.window.close();});return {tracker,doc:dom.window.document,app};}
test('approved workspace exposes cashflow, assistant, review and module settings',t=>{const {doc}=fixture(t);for(const id of ['workspace-cashflow','workspace-assistant','workspace-review','workspace-settings'])assert.ok(doc.getElementById(id),id);});
test('module preferences persist independently from the ledger and cancel does not apply draft edits',async t=>{
  const {tracker}=fixture(t);assert.equal(typeof tracker.setupWorkspace,'function');await tracker.setupWorkspace();
  const before=JSON.stringify(tracker.data);tracker.ws.prefsDraft={...tracker.ws.prefs,theme:'dark'};await tracker.saveWorkspacePreferences();assert.equal(tracker.ws.prefs.theme,'dark');assert.equal(JSON.stringify(tracker.data),before);
  tracker.ws.prefsDraft={...tracker.ws.prefs,theme:'light'};tracker.cancelWorkspacePreferences();assert.equal(tracker.ws.prefs.theme,'dark');
});
test('failed durable save keeps a draft pending and cannot show success',async t=>{
  const {tracker}=fixture(t);assert.equal(typeof tracker.commitWorkspaceDrafts,'function');await tracker.setupWorkspace();
  tracker.assertWritable=()=>{};tracker.saveData=async()=>{throw Error('save unknown');};
  tracker.ws.drafts=[{id:'one',source:'assistant',status:'pending',proposal:{date:'2026-09-26',amount:'32.00',direction:'expense',currency:'CNY',accountId:'cash-cny',purpose:'餐饮美食',description:'午餐',projectId:'',expenseCategoryId:''}}];
  tracker.ws.reviewBasis=JSON.stringify(tracker.data);await tracker.commitWorkspaceDrafts(['one']);assert.equal(tracker.ws.drafts[0].status,'pending');assert.match(tracker.ws.message,/save unknown/);assert.equal(tracker.ws.commitUncertain,true);
});
test('a failed full-book replacement preserves drafts and the current model scope',async t=>{
  const {tracker}=fixture(t);await tracker.setupWorkspace();tracker.ws.drafts=[{id:'keep-me',source:'manual',status:'pending',proposal:{}}];tracker.ws.connection.enabled=true;
  tracker.assertWritable=()=>{};tracker.exportToJSON=async()=>true;
  tracker.fileAdapter.openImport=async()=>({text:JSON.stringify(tracker.getDefaultState()),encoding:'text'});
  tracker.fileAdapter.saveFile=async()=>({});tracker.saveData=async()=>{throw Error('not committed');};tracker.refreshDataViews=()=>{};
  await tracker.importFullBook();assert.equal(tracker.ws.drafts.length,1);assert.equal(tracker.ws.drafts[0].id,'keep-me');assert.equal(tracker.ws.connection.enabled,true);
});
test('unreadable auxiliary state cannot be overwritten by saving a layout',async t=>{
  const {tracker,app}=fixture(t,{localStorageSeed:{'assetTracker.workspace.v1':'{broken draft data'}});await tracker.setupWorkspace();
  tracker.ws.prefsDraft={...tracker.ws.prefs,theme:'dark'};await tracker.saveWorkspacePreferences();
  assert.equal(app.readLocalStorage('assetTracker.workspace.v1'),'{broken draft data');assert.equal(tracker.ws.storageReadOnly,true);
});
test('workspace scope mismatch quarantines old drafts and model consent',async t=>{
  const saved={scope:'old-book',drafts:[{id:'old',source:'manual',status:'pending',proposal:{}}],connection:{provider:'ollama',baseURL:'http://localhost:11434',model:'qwen3:1.7b',enabled:true,allowText:true}};
  const {tracker}=fixture(t,{localStorageSeed:{'assetTracker.workspace.v1':JSON.stringify(saved)}});tracker.data.workspaceScope='new-book';await tracker.setupWorkspace();
  assert.equal(tracker.ws.drafts.length,0);assert.equal(tracker.ws.connection.enabled,false);assert.equal(tracker.ws.storageReadOnly,true);
});
test('two tabs cannot overwrite a newer draft while saving unrelated preferences',async t=>{
  const entries=new Map();const storage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>entries.set(k,v),removeItem:k=>entries.delete(k)};
  const a=fixture(t,{storage}),b=fixture(t,{storage});await a.tracker.setupWorkspace();await b.tracker.setupWorkspace();
  await a.tracker.newWorkspaceDraft();b.tracker.ws.prefsDraft={...b.tracker.ws.prefs,theme:'dark'};await b.tracker.saveWorkspacePreferences();
  assert.equal(JSON.parse(entries.get('assetTracker.workspace.v1')).drafts.length,1);assert.match(b.tracker.ws.message,/窗口|更改|冲突/);
});
test('completed history does not permanently exhaust pending capacity',async t=>{
  const {tracker}=fixture(t);await tracker.setupWorkspace();tracker.ws.drafts=Array.from({length:1000},(_,i)=>({id:'done-'+i,status:'committed',source:'manual',proposal:{}}));
  await tracker.newWorkspaceDraft();assert.equal(tracker.ws.drafts.filter(d=>d.status==='pending').length,1);assert.ok(tracker.ws.drafts.length<=201);
});
test('interrupted replacement cleanup cannot reuse old drafts or cloud consent after reload',async t=>{
  const entries=new Map();let failArchive=false;
  const storage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>{if(failArchive&&k.includes('.recovery.'))throw Error('archive unavailable');entries.set(k,v);},removeItem:k=>entries.delete(k)};
  const a=fixture(t,{storage});await a.tracker.setupWorkspace();await a.tracker.newWorkspaceDraft();a.tracker.ws.connection={...a.tracker.ws.connection,enabled:true,allowText:true};await a.tracker.persistWorkspace();const original=entries.get('assetTracker.workspace.v1');
  a.tracker.saveData=async()=>{};a.tracker.refreshDataViews=()=>{};failArchive=true;await a.tracker.resetToDefaultData();
  assert.ok(a.tracker.data.workspaceScope);assert.equal(entries.get('assetTracker.workspace.v1'),original);
  const b=fixture(t,{storage});b.tracker.data=JSON.parse(JSON.stringify(a.tracker.data));await b.tracker.setupWorkspace();
  assert.equal(b.tracker.ws.drafts.length,0);assert.equal(b.tracker.ws.connection.enabled,false);assert.equal(b.tracker.ws.storageReadOnly,true);
});
test('approved recovery keeps the exact original corrupt source before replacing workspace',async t=>{
  const original='{corrupt-but-recoverable';const {tracker,app}=fixture(t,{localStorageSeed:{'assetTracker.workspace.v1':original}});await tracker.setupWorkspace();
  await tracker.recoverWorkspace();assert.equal(tracker.ws.storageReadOnly,false);
  assert.ok(app.localStorageWrites.some(w=>w.key.startsWith('assetTracker.workspace.v1.recovery.')&&w.value===original));
  assert.equal(JSON.parse(app.readLocalStorage('assetTracker.workspace.v1')).drafts.length,0);
});
test('an in-flight replacement cannot stamp old drafts with the new book scope',async t=>{
  const entries=new Map();let failArchive=false;const storage={getItem:k=>entries.get(k)??null,setItem:(k,v)=>{if(failArchive&&k.includes('.recovery.'))throw Error('interrupted');entries.set(k,v);},removeItem:k=>entries.delete(k)};
  const a=fixture(t,{storage});await a.tracker.setupWorkspace();await a.tracker.newWorkspaceDraft();a.tracker.ws.connection.enabled=true;await a.tracker.persistWorkspace();
  let finish;const delayed=new Promise(resolve=>finish=resolve);a.tracker.saveData=()=>delayed;a.tracker.refreshDataViews=()=>{};
  const pending=a.tracker.resetToDefaultData();a.tracker.ws.prefsDraft={...a.tracker.ws.prefs,theme:'dark'};await a.tracker.saveWorkspacePreferences();
  failArchive=true;finish();await pending;
  const b=fixture(t,{storage});b.tracker.data=JSON.parse(JSON.stringify(a.tracker.data));await b.tracker.setupWorkspace();assert.equal(b.tracker.ws.drafts.length,0);assert.equal(b.tracker.ws.connection.enabled,false);assert.equal(b.tracker.ws.storageReadOnly,true);
});
test('raw recovery export refuses unavailable bytes and preserves an empty source exactly',async t=>{
  const {tracker}=fixture(t);await tracker.setupWorkspace();const writes=[];tracker.fileAdapter.saveFile=async p=>writes.push(p);
  tracker.ws.loadedText='{}';tracker.ws.rawReadable=false;tracker.ws.storageReadOnly=true;tracker.workspaceAction('workspace-export-raw',{});await Promise.resolve();assert.equal(writes.length,0);
  tracker.ws.rawReadable=true;tracker.ws.loadedText='';tracker.workspaceAction('workspace-export-raw',{});await Promise.resolve();assert.equal(writes[0].text,'');
});
test('overview does not show a complete net worth when an account lacks an exchange rate',async t=>{
  const {tracker,doc}=fixture(t);tracker.data.categories.foreign={id:'eur',name:'欧元',balance:10,currency:'EUR'};await tracker.setupWorkspace();
  assert.equal(doc.querySelector('.total-assets').textContent,'—');assert.match(doc.getElementById('net-assets-note').textContent,/EUR/);
});
test('editing a review row preserves and saves its draft when switching rows, without ledger mutation',async t=>{
  const {tracker,doc,app}=fixture(t);await tracker.setupWorkspace();const before=JSON.stringify(tracker.data);
  tracker.ws.drafts=['a','b'].map(id=>({id,status:'pending',source:'manual',proposal:{date:'2026-09-26',amount:'32',direction:'expense',currency:'CNY',accountId:'cash-cny',purpose:'餐饮美食',description:id,projectId:'',expenseCategoryId:''}}));tracker.ws.focusId='a';tracker.renderWorkspaceReview();
  const amount=doc.getElementById('ws-draft-amount');amount.value='45.50';amount.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));
  tracker.workspaceAction('select-draft',{dataset:{id:'b'}});tracker.workspaceAction('select-draft',{dataset:{id:'a'}});
  assert.equal(doc.getElementById('ws-draft-amount').value,'45.50');await new Promise(resolve=>setTimeout(resolve,350));
  assert.equal(JSON.parse(app.readLocalStorage('assetTracker.workspace.v1')).drafts.find(d=>d.id==='a').proposal.amount,'45.50');assert.equal(JSON.stringify(tracker.data),before);
});
test('replacement archives the latest typed draft even before its debounce fires',async t=>{
  const {tracker,doc,app}=fixture(t);await tracker.setupWorkspace();tracker.ws.drafts=[{id:'latest',status:'pending',source:'manual',proposal:{date:'2026-09-26',amount:'32',direction:'expense',currency:'CNY',accountId:'cash-cny',purpose:'餐饮美食',description:'午餐',projectId:'',expenseCategoryId:''}}];await tracker.persistWorkspace();tracker.renderWorkspaceReview();
  const amount=doc.getElementById('ws-draft-amount');amount.value='45.50';amount.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));tracker.saveData=async()=>{};tracker.refreshDataViews=()=>{};
  await tracker.resetToDefaultData();const backup=app.localStorageWrites.find(w=>w.key.startsWith('assetTracker.workspace.v1.recovery.'));assert.equal(JSON.parse(backup.value).drafts[0].proposal.amount,'45.50');
});
test('classification requests send selected fields, not unrecognized raw import columns',async t=>{
  const {tracker}=fixture(t);await tracker.setupWorkspace();tracker.ws.connection={...tracker.ws.connection,enabled:true,allowText:true,model:'test'};
  const proposal={date:'2026-09-26',amount:'32',direction:'expense',currency:'CNY',accountId:'cash-cny',purpose:'餐饮美食',description:'午餐',projectId:'',expenseCategoryId:''};
  const d={id:'classify',status:'pending',source:'import',sourceText:'SECRET-EXTRA-COLUMN',proposal};tracker.ws.drafts=[d];let sent;
  tracker.workspaceModelTransport=async(_c,_operation,body)=>{sent=JSON.stringify(body);return {message:{content:JSON.stringify(proposal)}};};
  await tracker.runWorkspaceAgent(d.sourceText,d);assert.ok(sent.includes('午餐'));assert.ok(!sent.includes('SECRET-EXTRA-COLUMN'));
});
test('after asynchronous workspace startup, an empty book shows guidance instead of a zero-value chart',async t=>{
  const {tracker,doc}=fixture(t);await tracker.setupWorkspace();assert.equal(doc.getElementById('assetTrendChart').hidden,true);assert.match(doc.getElementById('workspace-trend-empty').textContent,/第一笔/);
});
test('successful confirmation clears the submitted assistant text and its stale ready message',async t=>{
  const {tracker,doc}=fixture(t);await tracker.setupWorkspace();tracker.assertWritable=()=>{};tracker.saveData=async()=>{};tracker.refreshDataViews=()=>{};
  const text='午餐32元';tracker.ws.drafts=[{id:'done',source:'assistant',status:'pending',sourceText:text,proposal:{date:'2026-09-26',amount:'32',direction:'expense',currency:'CNY',accountId:'cash-cny',purpose:'餐饮美食',description:'午餐',projectId:'',expenseCategoryId:''}}];tracker.ws.reviewBasis=JSON.stringify(tracker.data);doc.getElementById('workspace-review').classList.add('active');doc.getElementById('workspace-agent-input').value=text;
  await tracker.commitWorkspaceDrafts(['done']);assert.equal(doc.getElementById('workspace-agent-input').value,'');assert.match(doc.getElementById('workspace-agent-result').textContent,/已保存/);
});

test('offline recognition creates review drafts without invoking a provider or changing balances',async t=>{
 const {tracker}=fixture(t);await tracker.setupWorkspace();const before=JSON.stringify(tracker.data);tracker.workspaceModelTransport=async()=>{throw Error('unexpected model request');};
 assert.equal(typeof tracker.recognizeWorkspaceText,'function');await tracker.recognizeWorkspaceText('2026-10-02 午餐支出32元，现金 / 人民币');
 assert.equal(tracker.ws.drafts.length,1);assert.equal(tracker.ws.drafts[0].source,'offline');assert.equal(tracker.ws.drafts[0].proposal.amount,'32');assert.equal(JSON.stringify(tracker.data),before);
});
test('duplicate detail shows matched record and clears consent after editing',async t=>{
 const {tracker,doc}=fixture(t);await tracker.setupWorkspace();tracker.assertWritable=()=>{};tracker.saveData=async()=>{};tracker.refreshDataViews=()=>{};
 const p={date:'2026-09-26',amount:'32',direction:'expense',currency:'CNY',accountId:'cash-cny',purpose:'餐饮美食',description:'午餐',projectId:'',expenseCategoryId:''};
 tracker.data.transactions.push({id:'old',date:p.date,amount:-32,currency:'CNY',accountId:'cash-cny',category:'现金',subcategory:'人民币',description:'午餐',type:'单次',purpose:p.purpose});
 const d={id:'new',source:'assistant',status:'pending',proposal:p};tracker.ws.drafts=[d];tracker.ws.focusId=d.id;tracker.renderWorkspaceReview();
 assert.match(doc.getElementById('workspace-review-detail').textContent,/old/);assert.equal(tracker.ws.drafts[0].suspected,true);assert.equal(await tracker.commitWorkspaceDrafts([d.id]),false);
 const choice=doc.getElementById('ws-draft-duplicate');choice.checked=true;choice.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));
 assert.ok(tracker.ws.drafts[0].duplicateDecision);const description=doc.getElementById('ws-draft-description');description.value=' 午餐 ';description.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));assert.equal(tracker.ws.drafts[0].duplicateDecision,undefined);
 assert.equal(await tracker.commitWorkspaceDrafts([d.id]),false);
});
test('review can correct transaction time and preserves an untouched precise timestamp',async t=>{
 const {tracker,doc}=fixture(t);await tracker.setupWorkspace();await tracker.recognizeWorkspaceText('2026-10-02 12:30:15 午餐支出32元，现金 / 人民币');
 assert.equal(doc.getElementById('ws-draft-time').value,'12:30:15');
 const time=doc.getElementById('ws-draft-time');time.value='13:10:30';time.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));assert.equal(tracker.ws.drafts[0].proposal.date,'2026-10-02T13:10:30');
});
test('oversized spreadsheet previews cannot silently discard trailing bill rows',async t=>{
 const {tracker,doc,app}=fixture(t);await tracker.setupWorkspace();tracker.openWorkspaceRecognition();
 const X=require('../vendor/xlsx.full.min.js');app.context.XLSX=X;
 const rows=[['交易时间','金额(元)','收/支','支付方式'],...Array.from({length:1105},()=>['2026-10-02',32,'支出','现金 / 人民币'])];
 const b=X.utils.book_new();X.utils.book_append_sheet(b,X.utils.aoa_to_sheet(rows),'bill');
 tracker.fileAdapter.openImport=async()=>({fileName:'large.xlsx',encoding:'base64',text:X.write(b,{bookType:'xlsx',type:'base64'})});
 await doc.getElementById('ws-recognition-file').onclick();assert.match(doc.getElementById('ws-recognition-status').textContent,/超过|上限/);assert.equal(tracker.ws.drafts.length,0);
});

test('selecting review rows preserves the editor node, selection and unsaved text',async t=>{
 const {tracker,doc}=fixture(t);await tracker.setupWorkspace();
 tracker.ws.drafts=['a','b'].map((id,i)=>({id,status:'pending',source:'manual',proposal:{date:'2026-10-02',amount:String(20+i),direction:'expense',currency:'CNY',accountId:'cash-cny',purpose:'',description:id,projectId:'',expenseCategoryId:''}}));tracker.ws.focusId='a';tracker.renderWorkspaceReview();
 const input=doc.getElementById('ws-draft-description');input.value='editing';input.focus();input.setSelectionRange(2,4);input.dispatchEvent(new doc.defaultView.Event('input',{bubbles:true}));
 const checkbox=doc.querySelector('[data-select-draft="b"]');checkbox.checked=true;checkbox.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));
 assert.equal(doc.getElementById('ws-draft-description'),input);assert.equal(doc.activeElement,input);assert.equal(input.selectionStart,2);assert.equal(input.selectionEnd,4);assert.equal(input.value,'editing');assert.equal(tracker.ws.selected.has('b'),true);
});
test('changing review focus reuses list rows and shows the selected draft',async t=>{
 const {tracker,doc}=fixture(t);await tracker.setupWorkspace();tracker.ws.drafts=['a','b'].map((id,i)=>({id,status:'pending',source:'manual',proposal:{date:'2026-10-02',amount:String(20+i),direction:'expense',currency:'CNY',accountId:'cash-cny',purpose:'',description:id,projectId:'',expenseCategoryId:''}}));tracker.ws.focusId='a';tracker.renderWorkspaceReview();
 const row=doc.querySelector('[data-ws-action="select-draft"][data-id="b"]');tracker.workspaceAction('select-draft',{dataset:{id:'b'}});
 assert.equal(doc.querySelector('[data-ws-action="select-draft"][data-id="b"]'),row);assert.equal(doc.getElementById('ws-draft-description').value,'b');
});
test('review actions are outside the scroll region and conflict gating stays explicit',async t=>{
 const {tracker,doc}=fixture(t);await tracker.setupWorkspace();await tracker.recognizeWorkspaceText('2026-10-02 午餐支出32元，现金 / 人民币');await tracker.recognizeWorkspaceText('2026-10-02 午餐支出32元，现金 / 人民币');
 const scroll=doc.querySelector('.ws-draft-scroll'),actions=doc.querySelector('.ws-review-detail-actions');assert.ok(scroll);assert.ok(actions);assert.equal(scroll.contains(actions),false);
 assert.equal(doc.getElementById('ws-confirm-draft').disabled,true);assert.match(doc.getElementById('ws-draft-submit-hint').textContent,/重复|核对/);
 const choice=doc.getElementById('ws-draft-duplicate');choice.checked=true;choice.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));assert.equal(doc.getElementById('ws-confirm-draft').disabled,false);
});
test('offline recognition opens with the existing text field focused',async t=>{
 const {tracker,doc}=fixture(t);await tracker.setupWorkspace();tracker.openWorkspaceRecognition();assert.equal(doc.activeElement,doc.getElementById('ws-recognition-text'));
});
test('full source remains readable for dismissed drafts and read-only workspace',async t=>{
 const {tracker,doc}=fixture(t);await tracker.setupWorkspace();
 for(const [status,readOnly] of [['dismissed',false],['pending',true]]){
  tracker.ws.filter=status;tracker.ws.storageReadOnly=readOnly;tracker.ws.drafts=[{id:'source',status,source:'offline',sourceText:'完整原文 marker-123',proposal:{date:'2026-10-02',amount:'20',direction:'expense',currency:'CNY',accountId:'cash-cny',description:'只读测试',purpose:'',projectId:'',expenseCategoryId:''}}];tracker.renderWorkspaceReview();
  doc.querySelector('[data-ws-action="draft-source"]').click();assert.match(doc.getElementById('modal-body').textContent,/marker-123/);tracker.closeModal();
 }
});
