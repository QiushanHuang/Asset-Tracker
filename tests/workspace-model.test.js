const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const W = fs.existsSync(require('node:path').join(__dirname, '../workspace-model.js')) ? require('../workspace-model') : {};
const book = () => ({ categories: {cash:{id:'cash',name:'现金',currency:'CNY',balance:100},card:{id:'card',name:'信用卡',currency:'CNY',balance:10,isDebt:true}}, settings:{baseCurrency:'CNY',exchangeRates:{CNY:1,USD:7}}, transactions:[], expenseProjects:[], automationRules:[], purposeCategories:['餐饮','工资'] });
const draft = (id='one', more={}) => ({id,source:'assistant',status:'pending',proposal:{date:'2026-09-26',amount:'32.00',direction:'expense',currency:'CNY',accountId:'cash',purpose:'餐饮',description:'午餐',projectId:'',expenseCategoryId:'',...more}});

test('workspace preferences discard unknown modules, preserve order and allow hiding all', () => {
  assert.equal(typeof W.preferences,'function');
  const p=W.preferences({theme:'neon',modules:[{id:'assistant',visible:false},{id:'assistant',visible:true},{id:'evil'}]});
  assert.equal(p.theme,'light'); assert.equal(p.modules[0].id,'assistant');assert.equal(p.modules[0].visible,false);
  assert.equal(new Set(p.modules.map(m=>m.id)).size,p.modules.length);assert.ok(!p.modules.some(m=>m.id==='evil'));
  const hidden=W.preferences({...p,modules:p.modules.map(m=>({...m,visible:false}))});assert.ok(hidden.modules.every(m=>!m.visible));
});
test('monthly cashflow is bounded by business date, retains precision and flags missing FX',()=>{
  assert.equal(typeof W.cashflow,'function'); const b=book();
  b.transactions=[{date:'2026-09-01',amount:18000,currency:'CNY'},{date:'2026-09-26T14:00:00',amount:-6840.2,currency:'CNY'},{date:'2026-09-27',amount:-100,currency:'CNY'},{date:'2026-08-31',amount:-100,currency:'CNY'}];
  const x=W.cashflow(b,'2026-09-26','month-to-date');assert.equal(x.income,18000);assert.equal(x.expense,6840.2);assert.equal(x.net,11159.8);
  b.transactions.push({date:'2026-09-26',amount:-5,currency:'EUR'});assert.deepEqual(W.cashflow(b,'2026-09-26').missing,['EUR']);
});
test('only a valid balanced transfer pair is excluded from cashflow',()=>{
  assert.equal(typeof W.cashflow,'function');const b=book();
  b.transactions=[{id:'a',date:'2026-09-26',amount:-50,currency:'CNY',accountId:'cash',transferId:'t'},{id:'b',date:'2026-09-26',amount:50,currency:'CNY',accountId:'card',transferId:'t'}];
  assert.equal(W.cashflow(b,'2026-09-26').income,0);b.transactions.pop();assert.equal(W.cashflow(b,'2026-09-26').expense,50);
});
test('draft confirmation changes a clone once and recognizes its receipt after reload',()=>{
  assert.equal(typeof W.applyDrafts,'function');const b=book(),before=JSON.stringify(b),d=draft();
  const x=W.applyDrafts(b,[d]);assert.equal(JSON.stringify(b),before);assert.equal(x.categories.cash.balance,68);assert.equal(x.transactions.length,1);
  const replay=W.applyDrafts(x,[d]);assert.equal(replay.transactions.length,1);assert.equal(replay.categories.cash.balance,68);
  assert.equal(W.reconcile(x,[d])[0].status,'committed');
});
test('debt-account expenses increase debt and invalid batches are atomic',()=>{
  assert.equal(typeof W.applyDrafts,'function');const b=book(),before=JSON.stringify(b);
  assert.equal(W.applyDrafts(b,[draft('card',{accountId:'card'})]).categories.card.balance,42);
  assert.throws(()=>W.applyDrafts(b,[draft(),draft('bad',{accountId:'missing'})]),/账户/);assert.equal(JSON.stringify(b),before);
});
test('review rejects invalid dates, ambiguous amounts, unknown categories and foreign references',()=>{
  assert.equal(typeof W.proposal,'function');const b=book();
  for(const change of [{amount:'1e3'},{amount:'-2'},{date:'2026-02-31'},{date:'2026-09-26garbage'},{date:'2026-09-26T99:00:00'},{purpose:'invented'},{projectId:'missing'},{accountId:'missing'}]) assert.throws(()=>W.proposal(b,{...draft().proposal,...change}));
  assert.throws(()=>W.applyDrafts(b,[draft('x',{currency:'EUR'})]),/汇率/);
});
test('valid drafts never include model-supplied executable or receipt fields',()=>{
  assert.equal(typeof W.proposal,'function');const p=W.proposal(book(),{...draft().proposal,script:'steal()',id:'hijack',approved:true});
  assert.equal(p.script,undefined);assert.equal(p.id,undefined);assert.equal(p.approved,undefined);
});
test('duplicate cues do not delete or merge equal purchases',()=>{
  assert.equal(typeof W.duplicateGroups,'function');const b=book();b.transactions=[{id:'a',date:'2026-09-26',amount:-32,currency:'CNY',accountId:'cash',description:'午餐'},{id:'b',date:'2026-09-26',amount:-32,currency:'CNY',accountId:'cash',description:'午餐'}];
  const before=JSON.stringify(b);assert.equal(W.duplicateGroups(b).length,1);assert.equal(JSON.stringify(b),before);
});
test('a committed receipt prevents replay even if its transaction was later deleted',()=>{
  const b=W.applyDrafts(book(),[draft()]);b.transactions=[];
  const replay=W.applyDrafts(b,[draft()]);assert.equal(replay.transactions.length,0);assert.equal(replay.categories.cash.balance,68);
  assert.equal(W.reconcile(replay,[draft()])[0].status,'committed');
});
test('rule catch-up is a preview, clamps month-end and survives rule renames',()=>{
  assert.equal(typeof W.ruleDrafts,'function');const b=book();const rule={id:'rent',name:'房租',active:true,category:'现金',accountId:'cash',currency:'CNY',amount:-10,frequency:'monthly',startDate:'2026-01-31'};
  const schedule=require('../ledger-insights').scheduled,before=JSON.stringify(b),drafts=W.ruleDrafts(b,rule,'2026-03-02',schedule);
  assert.deepEqual(drafts.map(d=>d.proposal.date),['2026-01-31','2026-02-28']);assert.equal(JSON.stringify(b),before);
  b.automationRules=[{...rule}];const saved=W.applyDrafts(b,drafts);assert.equal(saved.automationRules[0].lastExecuted,'2026-02-28');rule.name='新房租';assert.equal(W.ruleDrafts(saved,rule,'2026-03-02',schedule).length,0);
});

test('all draft sources require current duplicate evidence before committing',()=>{
  const b=book(); b.transactions=[{id:'old',date:'2026-09-26T12:00',amount:-32,currency:'CNY',accountId:'cash',description:'午餐'}];
  for(const source of ['offline','assistant','mcp','import']) {
    const d={...draft(source),source};
    assert.throws(()=>W.applyDrafts(b,[d]),/重复/);
    const review=W.reviewDuplicates(b,d);assert.equal(review.matches[0].transactionId,'old');
    d.duplicateDecision={signature:review.signature,action:'keep'};
    assert.equal(W.applyDrafts(b,[d]).transactions.length,2);
    d.proposal.description='午餐 ';assert.throws(()=>W.applyDrafts(b,[d]),/重复/);
  }
});
test('duplicate decisions expire when matched evidence changes and batches are checked internally',()=>{
  const b=book(),a=draft('a'),d=draft('b');
  assert.throws(()=>W.applyDrafts(b,[a,d]),/重复/);
  const next=W.applyDrafts(b,[a]);d.duplicateDecision={signature:W.reviewDuplicates(next,d).signature,action:'keep'};
  next.transactions[0].description=' 午餐';assert.throws(()=>W.applyDrafts(next,[d]),/重复/);
});
test('source identities persist and conflicting IDs never silently commit',()=>{
  const d=draft();d.sourceIdentity={provider:'alipay',id:'0000123456789'};
  const b=W.applyDrafts(book(),[d]);assert.deepEqual(b.transactions[0].sourceIdentity,d.sourceIdentity);
  const other={...draft('other'),sourceIdentity:d.sourceIdentity};
  const review=W.reviewDuplicates(b,other);assert.equal(review.matches[0].level,'exact');
  other.duplicateDecision={signature:review.signature,action:'keep'};assert.throws(()=>W.applyDrafts(b,[other]),/来源|已有|重复/);
  d.proposal.amount='99';assert.throws(()=>W.applyDrafts(b,[d]),/冲突/);
});
test('reconciliation does not hide a conflicting import behind an existing receipt',()=>{
 const d={...draft(),source:'import',sourceId:'same'},b=W.applyDrafts(book(),[d]);d.proposal.amount='90';
 const recovered=W.reconcile(b,[d])[0];assert.equal(recovered.status,'pending');assert.match(recovered.error,/冲突/);
});
test('reconciling unchanged draft status retains editor identity without mutating status changes',()=>{
 const b=book(),d=draft(),same=W.reconcile(b,[d]);assert.equal(same[0],d);
 const saved=W.applyDrafts(b,[d]),next=W.reconcile(saved,[d]);assert.notEqual(next[0],d);assert.equal(next[0].status,'committed');assert.equal(d.status,'pending');
});
test('audit evidence changes invalidate duplicate cache and prior confirmation',()=>{
 const b=book(),d=draft('audit');b.transactions=[{id:'old',date:d.proposal.date,amount:-32,currency:'CNY',accountId:'cash',description:'午餐'}];b.importAudits=[{provider:'icbc',items:[]}];
 const before=W.duplicateReviewBasis(b,[d]);d.duplicateDecision={action:'keep',signature:W.reviewDuplicates(b,d).signature};
 assert.equal(W.applyDrafts(b,[d]).transactions.length,2);b.importAudits[0].items.push({row:1,decision:'excluded',record:{id:'evidence',date:'2026-09-26T09:00:00',amount:20,currency:'CNY'}});
 assert.notEqual(W.duplicateReviewBasis(b,[d]),before);assert.throws(()=>W.applyDrafts(b,[d]),/重新核对|重复/);
});
test('legacy account alias changes invalidate existing confirmation signatures',()=>{
 const b=book(),d=draft('alias');b.transactions=[{id:'old',date:d.proposal.date,amount:-32,currency:'CNY',accountId:'cash',description:'午餐'}];b.categories.cash.sourceCategoryId='old-cash';
 d.duplicateDecision={action:'keep',signature:W.reviewDuplicates(b,d).signature};b.categories.cash.sourceCategoryId='new-alias';assert.throws(()=>W.applyDrafts(b,[d]),/重新核对|重复/);
});
