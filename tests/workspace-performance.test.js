const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const {performance} = require('node:perf_hooks');

function fixture({transactions=10,drafts=3}={}) {
  const count={indexes:0,indexed:0,queries:0,panelWrites:0,statusUpdates:0,reviewRenders:0,workspaceRenders:0};
  const checkbox={checked:false,id:'ws-draft-duplicate'},panel={set innerHTML(value){this.html=value;count.panelWrites++;},get innerHTML(){return this.html||'';}};
  const context=vm.createContext({console,TextEncoder,crypto:require('node:crypto').webcrypto,document:{getElementById:id=>id==='ws-draft-duplicate'?checkbox:id==='ws-draft-duplicate-review'?panel:null}});
  const load=name=>vm.runInContext(fs.readFileSync(path.join(__dirname,'..',name),'utf8'),context,{filename:name});
  load('legacy-safety.js');load('ledger-dedup.js');
  const dedup=context.AssetTrackerDedup;
  context.AssetTrackerDedup={...dedup,createIndex(rows,options){
    count.indexes++;count.indexed+=rows.length;const index=dedup.createIndex(rows,options);
    return {...index,add(row){count.indexed++;return index.add(row);},findMatches(...args){count.queries++;return index.findMatches(...args);}};
  }};
  load('workspace-model.js');load('bill-recognition.js');load('bill-ui.js');
  class Tracker {}
  context.AssetTrackerBillUI.install(Tracker);
  const tracker=new Tracker();
  tracker.data={workspaceScope:'synthetic-book',categories:{cash:{id:'cash',name:'现金',currency:'CNY',balance:100000}},settings:{baseCurrency:'CNY',exchangeRates:{CNY:1}},purposeCategories:['餐饮'],expenseProjects:[],transactions:Array.from({length:transactions},(_,i)=>({id:'saved-'+i,date:'2026-10-02',accountId:'cash',amount:-(i+1),currency:'CNY',description:'商户'+i}))};
  tracker.ws={scope:'synthetic-book',selected:new Set(),drafts:Array.from({length:drafts},(_,i)=>({id:'candidate-'+i,status:'pending',source:'offline',proposal:{date:'2026-10-02',amount:String(i+1),direction:'expense',currency:'CNY',accountId:'cash',description:'商户'+i,purpose:'餐饮',projectId:'',expenseCategoryId:''}}))};
  tracker.updateWorkspaceDraftStatus=()=>count.statusUpdates++;
  tracker.assertWorkspaceWritable=()=>{};tracker.persistWorkspace=async()=>{};
  tracker.workspaceMessage=()=>{};
  tracker.renderWorkspaceReview=()=>{count.reviewRenders++;tracker.refreshWorkspaceDuplicates();};
  tracker.renderWorkspace=()=>count.workspaceRenders++;
  tracker.openWorkspaceSection=()=>tracker.renderWorkspaceReview();
  return {tracker,count,checkbox,panel,W:context.AssetTrackerWorkspace};
}

test('5,000 transactions and 100 drafts reuse unchanged duplicate analysis across refreshes',t=>{
  const {tracker,count}=fixture({transactions:5000,drafts:100});
  const start=performance.now();
  for(let i=0;i<20;i++)tracker.refreshWorkspaceDuplicates();
  t.diagnostic(JSON.stringify({scenario:'20 unchanged refreshes, 5000 transactions / 100 drafts',elapsedMs:Math.round((performance.now()-start)*100)/100,...count}));
  assert.equal(count.indexes,1,'unchanged refreshes should not rebuild the full index');
  assert.equal(count.indexed,5100);assert.equal(count.queries,100);
  const reviews=tracker.ws.duplicateReviews;
  tracker.data=JSON.parse(JSON.stringify(tracker.data));tracker.ws.drafts=JSON.parse(JSON.stringify(tracker.ws.drafts));
  tracker.refreshWorkspaceDuplicates();assert.equal(count.indexes,1,'equal contents may be reused after object replacement');assert.equal(tracker.ws.duplicateReviews,reviews);
});

test('duplicate checkbox input/change and unchanged field events preserve evidence and DOM',()=>{
  const {tracker,count,checkbox}=fixture();tracker.refreshWorkspaceDuplicates();const d=tracker.ws.drafts[0],review=tracker.ws.duplicateReviews.get(d.id);
  checkbox.checked=true;
  tracker.updateWorkspaceDuplicateChoice(d,{type:'input',target:checkbox});
  tracker.updateWorkspaceDuplicateChoice(d,{type:'change',target:checkbox});
  tracker.updateWorkspaceDuplicateChoice(d,{type:'change',target:{id:'ws-draft-description'}});
  assert.equal(d.duplicateConfirmed,true);assert.equal(d.duplicateDecision.signature,review.signature);
  assert.equal(count.indexes,1);assert.equal(count.queries,3);assert.equal(count.panelWrites,0,'unchanged evidence should retain its DOM and open disclosure state');
  assert.equal(count.statusUpdates,3);
});

test('5,000 transactions and 100 drafts analyze one changed value once across input/change',t=>{
  const {tracker,count}=fixture({transactions:5000,drafts:100});tracker.refreshWorkspaceDuplicates();
  const d=tracker.ws.drafts[0],event={target:{id:'ws-draft-description'}};
  const start=performance.now();
  for(let i=0;i<10;i++){
    d.proposal.description='商户0-'+i;
    tracker.updateWorkspaceDuplicateChoice(d,{...event,type:'input'});
    tracker.updateWorkspaceDuplicateChoice(d,{...event,type:'change'});
  }
  t.diagnostic(JSON.stringify({scenario:'10 edits with input+change, 5000 transactions / 100 drafts',elapsedMs:Math.round((performance.now()-start)*100)/100,...count}));
  assert.equal(count.indexes,11);assert.equal(count.queries,1100);assert.equal(count.panelWrites,10);
});

test('an actual in-place candidate edit recomputes once and invalidates the old decision',()=>{
  const {tracker,count,checkbox}=fixture();tracker.refreshWorkspaceDuplicates();const d=tracker.ws.drafts[0];
  d.duplicateDecision={action:'keep',signature:tracker.ws.duplicateReviews.get(d.id).signature};
  d.proposal.description='商户0号';checkbox.checked=true;
  tracker.updateWorkspaceDuplicateChoice(d,{type:'input',target:{id:'ws-draft-description'}});
  tracker.updateWorkspaceDuplicateChoice(d,{type:'change',target:{id:'ws-draft-description'}});
  assert.equal(count.indexes,2);assert.equal(count.queries,6);assert.equal(d.duplicateConfirmed,false);assert.equal(d.duplicateDecision,undefined);assert.equal(count.panelWrites,1);
});

test('ledger edits, source identities, account structure and book scope invalidate cached evidence',()=>{
  for(const mutate of [
    tracker=>tracker.data.transactions[0].description='商户0号',
    tracker=>tracker.data.transactions[0].sourceIdentity={provider:'wechat',id:'001'},
    tracker=>tracker.data.categories.cash.name='随身现金',
    tracker=>tracker.data.workspaceScope='another-book',
    tracker=>tracker.ws.scope='another-workspace',
  ]) {
    const {tracker,count}=fixture();tracker.refreshWorkspaceDuplicates();const d=tracker.ws.drafts[0];
    d.duplicateDecision={action:'keep',signature:tracker.ws.duplicateReviews.get(d.id).signature};
    tracker.refreshWorkspaceDuplicates();assert.equal(d.duplicateConfirmed,true);
    mutate(tracker);tracker.refreshWorkspaceDuplicates();
    assert.equal(count.indexes,2);assert.equal(d.duplicateConfirmed,false);assert.equal(d.duplicateDecision,undefined);
  }
});

test('pending draft edits, dismissal, insertion and deletion always update matching peers',()=>{
  const {tracker,count}=fixture({transactions:0,drafts:2});tracker.ws.drafts[1].proposal={...tracker.ws.drafts[0].proposal};
  tracker.refreshWorkspaceDuplicates();assert.equal(tracker.ws.drafts[0].suspected,true);
  tracker.ws.drafts[1].status='dismissed';tracker.refreshWorkspaceDuplicates();assert.equal(tracker.ws.drafts[0].suspected,false);
  tracker.ws.drafts[1].status='pending';tracker.refreshWorkspaceDuplicates();assert.equal(tracker.ws.drafts[0].suspected,true);
  tracker.ws.drafts[1].proposal.amount='40';tracker.refreshWorkspaceDuplicates();assert.equal(tracker.ws.drafts[0].suspected,false);
  tracker.ws.drafts.push({...tracker.ws.drafts[0],id:'another-candidate'});tracker.refreshWorkspaceDuplicates();assert.equal(tracker.ws.drafts[0].suspected,true);
  tracker.ws.drafts.pop();tracker.refreshWorkspaceDuplicates();assert.equal(tracker.ws.drafts[0].suspected,false);
  assert.equal(count.indexes,6);
});

test('changed legacy account resolution and base currency cannot reuse stale results',()=>{
  const {tracker}=fixture({transactions:1,drafts:1});const saved=tracker.data.transactions[0];delete saved.accountId;saved.category='现金';delete saved.currency;
  tracker.refreshWorkspaceDuplicates();assert.equal(tracker.ws.drafts[0].suspected,true);
  tracker.data.categories.other={id:'other',name:'现金',currency:'CNY',balance:0};tracker.refreshWorkspaceDuplicates();assert.equal(tracker.ws.drafts[0].suspected,false);
  delete tracker.data.categories.other;tracker.refreshWorkspaceDuplicates();assert.equal(tracker.ws.drafts[0].suspected,true);
  tracker.data.settings.baseCurrency='USD';tracker.refreshWorkspaceDuplicates();assert.equal(tracker.ws.drafts[0].suspected,false);
});

test('commit recalculates fresh evidence after a warmed UI cache',()=>{
  const {tracker,W}=fixture({transactions:1,drafts:1});tracker.refreshWorkspaceDuplicates();const d=tracker.ws.drafts[0];
  d.duplicateDecision={action:'keep',signature:tracker.ws.duplicateReviews.get(d.id).signature};
  assert.equal(W.applyDrafts(tracker.data,[d]).transactions.length,2);
  tracker.data.transactions[0].description='商户0号';
  assert.throws(()=>W.applyDrafts(tracker.data,[d]),/重新核对/);
});

test('offline recognition batches analysis and renders the review once after durable staging',async()=>{
  const {tracker,count}=fixture({transactions:1,drafts:0});
  await tracker.recognizeWorkspaceText('2026-10-02 现金午餐32元');
  assert.equal(tracker.ws.drafts.length,1);assert.equal(count.reviewRenders,1);assert.equal(count.workspaceRenders,1);assert.equal(count.indexes,1);
});
