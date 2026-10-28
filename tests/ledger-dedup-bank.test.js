const test = require('node:test');
const assert = require('node:assert/strict');
const D = require('../ledger-dedup');

// Deliberately synthetic examples. No real ledger rows or account details.
const tx = (extra = {}) => ({id:'a',date:'2030-04-07T12:00:00',accountId:'bank-a',category:'银行',subcategory:'账户甲',amount:-25,currency:'CNY',description:'合成商户',...extra});
const bank = (id, amount, balance, minute, row, extra = {}) => tx({id,amount,date:`2030-04-07T12:${String(minute).padStart(2,'0')}:00`,includeTime:true,
  icbc:{transactionId:`derived-${id}`,accountFingerprint:'synthetic-account-fingerprint',bankBalanceCents:balance,sourcePage:1,sourceRow:row,product:'合成商户',transactionType:'消费',...extra.icbc},...extra,
  ...(extra.icbc?{icbc:{transactionId:`derived-${id}`,accountFingerprint:'synthetic-account-fingerprint',bankBalanceCents:balance,sourcePage:1,sourceRow:row,product:'合成商户',transactionType:'消费',...extra.icbc}}:{})});
const makeBook = (rows = [], items = rows.map(t=>({sourceId:t.id,decision:'imported',record:{id:t.id,date:t.date,amount:t.amount,currency:t.currency}}))) => ({
  categories:{bank:{name:'银行',children:{a:{id:'bank-a',name:'账户甲',currency:'CNY'},b:{id:'bank-b',name:'账户乙',currency:'CNY'}}}},
  settings:{baseCurrency:'CNY'},transactions:rows,importAudits:[{id:'audit-synthetic',provider:'icbc',fileName:'synthetic.pdf',items}],
});
function chain(amount = 25) {
  const a=bank('first',-amount,10000-amount*100,0,1), middle=bank('middle',amount,10000,1,2), b=bank('last',-amount,10000-amount*100,2,3);
  const book=makeBook([a,b],[{sourceId:a.id,decision:'imported',record:{id:a.id,date:a.date,amount:a.amount,currency:a.currency}},
    {sourceId:middle.id,decision:'excluded',candidate:middle},{sourceId:b.id,decision:'imported',record:{id:b.id,date:b.date,amount:b.amount,currency:b.currency}}]);
  return {a,b,middle,book};
}
function explain(a,b,options) {assert.equal(typeof D.explainPair,'function');return D.explainPair(a,b,options);}

test('nested payment-provider transaction IDs are real identities with conflict precedence',()=>{
  for(const provider of ['wechat','alipay']) {
    const a=tx({[provider]:{transactionId:'real-order-1',counterparty:'合成商户'}}),b=tx({id:'b',[provider]:{transactionId:'real-order-1',counterparty:'合成商户'}});
    assert.equal(D.compare(a,b).level,'exact');
    assert.equal(D.compare(a,{...b,amount:-99}).level,'conflict');
    assert.equal(D.compare(a,{...b,[provider]:{transactionId:'real-order-2'}}),null);
    assert.equal(explain(a,{...b,[provider]:{transactionId:'real-order-2'}}).kind,'distinct');
  }
  const a=tx({wechat:{transactionId:'shared-number'}}),b=tx({id:'b',alipay:{transactionId:'shared-number'}});
  assert.equal(D.compare(a,b).level,'possible');
});

test('a unique legacy sourceCategoryId binds an account without guessing from names',()=>{
  const book=makeBook(),a=tx({accountId:undefined,sourceCategoryId:'bank-a',category:'旧名称',subcategory:'旧标签'}),b=tx({id:'b'});
  assert.equal(D.compare(a,b,{book}).level,'high');
  book.categories.other={id:'bank-a',name:'另一个账户'};
  assert.equal(D.compare(a,b,{book}),null);
});

test('explicit legacy IDs on account leaves map uniquely to current IDs and ambiguous aliases fail closed',()=>{
  const book=makeBook();book.categories.bank.children.a.sourceCategoryId='old-category';
  const a=tx({accountId:undefined,sourceCategoryId:'old-category',category:'旧名称'}),b=tx({id:'b'});
  assert.equal(D.compare(a,b,{book})?.level,'high');
  assert.equal(D.findMatches(a,[b],{book}).length,1);assert.equal(D.scan([a,b],{book}).length,1);
  book.categories.bank.children.b.sourceCategoryId='old-category';
  assert.equal(D.compare(a,b,{book}),null);
});

test('explicit account IDs require a unique leaf when a book tree is supplied',()=>{
  const identity={provider:'wechat',id:'known-order'},a=tx({accountId:'unknown-account',sourceCategoryId:'bank-a',sourceIdentity:identity}),b=tx({id:'b',accountId:'unknown-account',sourceIdentity:identity});
  assert.equal(D.compare(a,b).level,'exact','without a tree retain bare-ID comparison compatibility');
  const book=makeBook();assert.equal(D.compare(a,b,{book}).level,'possible');
  assert.equal(D.findMatches(a,[b],{book})[0].level,'possible');
  assert.equal(D.compare({...a,sourceIdentity:undefined},{...b,sourceIdentity:undefined},{book}),null);
  book.categories.duplicate={id:'bank-a',name:'duplicate leaf',currency:'CNY'};
  assert.equal(D.compare({...a,accountId:'bank-a'},{...b,accountId:'bank-a'},{book}).level,'possible');
  assert.equal(D.scan([{...a,accountId:'bank-a'},{...b,accountId:'bank-a'}],{book})[0].level,'possible');
});

test('top-level and nested real IDs share cross-bucket conflict lookup',()=>{
  const a=tx({sourceIdentity:{provider:'wechat',id:'real-order-1'}});
  const b=tx({id:'b',date:'2030-04-09',accountId:'bank-b',amount:-88,wechat:{transactionId:'real-order-1'}});
  assert.equal(D.compare(a,b).level,'conflict');
  assert.equal(D.findMatches(a,[b])[0].level,'conflict');assert.equal(D.scan([a,b])[0].level,'conflict');
});

test('bank row hashes and explicitly derived identities never masquerade as real order IDs',()=>{
  const a=bank('a',-25,7500,0,1),b=bank('b',-25,7500,0,1);
  assert.equal(D.compare(a,b).level,'high','different derived hashes must not suppress content matches');
  const sameHash={...b,icbc:{...b.icbc,transactionId:a.icbc.transactionId}};
  assert.equal(D.compare(a,sameHash).level,'high','equal derived hashes alone are not exact identity');
  for(const kind of ['derived','derived-bank-row-sha256','hash']) {
    const x=tx({sourceIdentity:{provider:'custom-bank',id:'row-fingerprint',kind}}),y=tx({id:'b',sourceIdentity:x.sourceIdentity});
    assert.equal(D.compare(x,y).level,'high');
    assert.equal(D.compare(x,{...y,sourceIdentity:{...x.sourceIdentity,id:'another-fingerprint'}}).level,'high');
  }
});

test('known different bank balances explain separate postings, while identity conflicts still block',()=>{
  const a=bank('a',-25,7500,0,1),b=bank('b',-25,5000,1,2);
  assert.equal(D.compare(a,b),null);
  const result=explain(a,b);assert.equal(result.kind,'distinct');assert.equal(result.evidence.type,'different-bank-balances');
  assert.match(result.reasons.join(' '),/余额|记账/);
  assert.equal(D.compare(a,{...b,id:a.id}).level,'conflict');
  assert.ok(D.compare(a,{...b,icbc:{...b.icbc,accountFingerprint:''}}),'missing physical account evidence cannot exclude');
});

test('recorded full bank sequence explains equal balances without changing any transactions or audit decisions',()=>{
  for(const amount of [25,40,15]) {
    const {a,b,book}=chain(amount),before=JSON.stringify(book);
    assert.equal(D.compare(a,b,{book}),null);
    const e=explain(a,b,{book});assert.equal(e.kind,'distinct');assert.equal(e.evidence.type,'bank-balance-chain');
    assert.equal(e.evidence.intermediateCount,1);assert.equal(e.evidence.rows.length,3);
    assert.deepEqual(e.evidence.rows.map(r=>r.sourceRow),[1,2,3]);
    assert.match(e.evidence.limitation,/用途|资金/);
    assert.equal(JSON.stringify(book),before);
  }
});

test('complete cross-page bank evidence includes excluded and pending rows without importing them',()=>{
  const a=bank('first',-25,7500,0,1),m1=bank('topup',30,10500,1,2),m2=bank('fee',-10,9500,2,1,{icbc:{sourcePage:2}}),m3=bank('credit',5,10000,3,2,{icbc:{sourcePage:2}}),b=bank('last',-25,7500,4,3,{icbc:{sourcePage:2}});
  const book=makeBook([a,b],[{sourceId:a.id,record:a},{sourceId:m1.id,decision:'pending',candidate:m1},{sourceId:m2.id,decision:'excluded',candidate:m2},{sourceId:m3.id,decision:'excluded',candidate:m3},{sourceId:b.id,record:b}]);
  book.importAudits[0].verification=[{page:1,count:2},{page:2,count:3}];
  const result=explain(a,b,{book});assert.equal(result.kind,'distinct');assert.equal(result.evidence.intermediateCount,3);
  assert.equal(book.transactions.length,2);assert.equal(book.importAudits[0].items[1].decision,'pending');
});

test('missing, broken, ambiguous or insufficiently timed bank evidence never suppresses a candidate',()=>{
  const changes=[
    x=>x.book.importAudits[0].items.splice(1,1),
    x=>x.middle.icbc.bankBalanceCents++,
    x=>delete x.middle.icbc.bankBalanceCents,
    x=>delete x.middle.currency,
    x=>x.book.importAudits[0].items.push({...x.book.importAudits[0].items[1]}),
    x=>x.middle.icbc.sourceRow=1,
    x=>x.middle.id=x.a.id,
    x=>x.b.date=x.a.date,
    x=>x.b.date=x.b.date.slice(0,10),
    x=>x.middle.date=x.middle.date.slice(0,10),
    x=>x.b.includeTime=false,
    x=>x.b.icbc.sourceRow=5,
    x=>x.b.date='2030-04-07T11:00:00',
    x=>x.book.importAudits=[],
  ];
  for(const change of changes) {
    const x=chain();change(x);
    assert.ok(D.compare(x.a,x.b,{book:x.book}),change.toString());
    assert.equal(explain(x.a,x.b,{book:x.book}).kind,'duplicate',change.toString());
  }
});

test('bank audit endpoint disagreement and unverified page boundaries cannot explain away edits',()=>{
  const x=chain();x.book.importAudits[0].items[2].candidate={...x.b,amount:-50};
  assert.ok(D.compare(x.a,x.b,{book:x.book}));
  const y=chain();y.b.icbc.sourcePage=2;y.b.icbc.sourceRow=1;
  assert.ok(D.compare(y.a,y.b,{book:y.book}));
});

test('unknown account metadata in an intervening row cannot be skipped out of a supposedly complete bank chain',()=>{
  const a=bank('first',-25,7500,0,1),unknown=bank('unknown',0,7500,1,2,{icbc:{accountFingerprint:''}}),topup=bank('topup',25,10000,2,3),b=bank('last',-25,7500,3,4);
  const book=makeBook([a,b],[{sourceId:a.id,record:a},{sourceId:unknown.id,candidate:unknown},{sourceId:topup.id,candidate:topup},{sourceId:b.id,record:b}]);
  assert.ok(D.compare(a,b,{book}));assert.equal(explain(a,b,{book}).kind,'duplicate');
});

test('nested merchant evidence excludes PDF page annotations from merchant matching',()=>{
  const a=bank('a',-25,7500,0,1,{description:'合成商户 · PDF 第 1 页，账后余额 75'}),b=bank('b',-25,7500,0,1,{description:'合成商户 · PDF 第 8 页，账后余额 75'});
  assert.equal(D.compare(a,b).level,'high');
});

test('equal opposite amounts with supported nearby transfer text are related, never duplicates',()=>{
  const a=tx({description:'账户转账',amount:-25}),b=tx({id:'b',date:'2030-04-07T12:05:00',accountId:'bank-b',description:'转账入账',amount:25});
  assert.equal(D.compare(a,b),null);assert.equal(explain(a,b).kind,'related');
  assert.equal(typeof D.scanRelated,'function');assert.equal(D.scanRelated([a,b]).length,1);assert.equal(D.scan([a,b]).length,0);
  assert.match(explain(a,b).reasons.join(' '),/不.*删除|不能.*删除|不是.*重复/);
});

test('related-flow rules reject unrelated near-time amounts, distant transfers and currency mismatches',()=>{
  const a=tx({amount:-25,description:'合成商户午餐'}),b=tx({id:'b',amount:25,accountId:'bank-b',date:'2030-04-07T12:01:00',description:'工资'});
  assert.equal(explain(a,b).kind,'unrelated');
  assert.equal(explain({...a,description:'转账'},{...b,date:'2030-04-08T12:01:00',description:'转账'}).kind,'unrelated');
  assert.equal(explain({...a,description:'转账'},{...b,currency:'USD',description:'转账'}).kind,'unrelated');
  assert.equal(explain({...a,description:'转账'},{...b,amount:-25,description:'转账'}).kind,'unrelated');
  assert.equal(explain({...a,description:'转账',date:'2030-04-07'},{...b,description:'转账',date:'2030-04-08'}).kind,'unrelated');
});

test('same-account refunds need matching merchant evidence, while cross-source time alone does not identify a duplicate',()=>{
  const a=tx({description:'合成商户付款'}),b=tx({id:'b',amount:25,date:'2030-04-07T12:10:00',description:'合成商户退款'});
  assert.equal(explain(a,b).kind,'related');
  assert.equal(explain(a,{...b,description:'其他商户退款'}).kind,'unrelated');
  const bankSide=bank('bank-side',-25,7500,0,1,{icbc:{product:'财付通平台扣款'},description:'财付通平台扣款'});
  const walletSide=tx({id:'wallet-side',description:'另一个商户',wechat:{transactionId:'real-other',paymentMethod:'零钱',counterparty:'另一个商户'}});
  assert.equal(D.compare(bankSide,walletSide),null);
});

test('shared indexes preprocess bank audits once and produce the same explanations as direct comparison',()=>{
  const {a,b,book}=chain(),audits=book.importAudits;let reads=0;
  Object.defineProperty(book,'importAudits',{get(){reads++;return audits;}});
  const index=D.createIndex([a],{book});
  for(let i=0;i<50;i++)assert.equal(index.findMatches(b).length,0);
  assert.equal(reads,1);assert.equal(typeof index.explainPair,'function');
  assert.equal(index.explainPair(a,b).kind,'distinct');assert.equal(reads,1);
  assert.equal(typeof D.scanDistinct,'function');assert.equal(D.scanDistinct([a,b],{book}).length,1);
  assert.equal(D.scan([a,b],{book}).length,0);
  assert.ok(typeof D.RULE_VERSION==='string'&&D.RULE_VERSION.length);
});

test('related scans are capped and incremental lookups use amount/day buckets',()=>{
  assert.equal(typeof D.scanRelated,'function');
  const rows=Array.from({length:60},(_,i)=>tx({id:`row-${i}`,amount:i%2?25:-25,accountId:i%2?'bank-b':'bank-a',description:'账户转账'}));
  const pairs=D.scanRelated(rows,{limit:7});assert.equal(pairs.length,7);assert.equal(pairs.truncated,true);
  assert.throws(()=>D.scanRelated(rows,{limit:0}),/上限/);
  const originals=Array.from({length:1000},(_,i)=>tx({id:`old-${i}`,amount:-(i+1),description:'账户转账'}));
  const index=D.createIndex(originals);assert.equal(typeof index.allRelated,'function');
  for(let i=0;i<1000;i++)assert.equal(index.allRelated(tx({id:`new-${i}`,accountId:'bank-b',amount:i+1,description:'账户转账'})).length,1);
  assert.equal(index.stats.comparisons,1000);
});

test('scan truncation reflects an omitted match rather than unrelated remaining input',()=>{
  const a=tx(),b=tx({id:'b'}),tail=tx({id:'tail',amount:-999});
  assert.equal(D.scan([a,b,tail],{limit:1}).truncated,false);
  assert.equal(D.scan([a,b,tx({id:'another'})],{limit:1}).truncated,true);
});

test('distinct queries skip dense non-bank buckets without performing comparisons',()=>{
  const rows=Array.from({length:600},(_,i)=>tx({id:`row-${i}`,wechat:{transactionId:`real-${i}`}}));
  const index=D.createIndex(rows);
  assert.equal(index.allDistinct(tx({id:'candidate'})).length,0);
  assert.equal(index.stats.comparisons,0);
  const scan=D.scanDistinct(rows);
  assert.equal(scan.length,0);assert.equal(scan.truncated,false);assert.equal(scan.stats.comparisons,0);
});

test('zero-result dense scans stop at the comparison budget and cannot claim a complete empty result',()=>{
  const rows=Array.from({length:900},(_,i)=>tx({id:`row-${i}`,wechat:{transactionId:`real-${i}`}}));
  const bounded=D.scan(rows,{maxComparisons:50});
  assert.equal(bounded.length,0);assert.equal(bounded.truncated,true);assert.equal(bounded.truncatedReason,'comparison-budget');
  assert.equal(bounded.stats.comparisons,50);assert.equal(bounded.stats.maxComparisons,50);
  const defaults=D.scan(rows);
  assert.equal(defaults.truncated,true);assert.equal(defaults.truncatedReason,'comparison-budget');
  assert.equal(defaults.stats.comparisons,200000);assert.equal(defaults.stats.maxComparisons,200000);
  assert.equal(Object.keys(bounded).includes('stats'),false);
  assert.equal(Object.keys(bounded).includes('truncatedReason'),false);
});

test('related scans also bound comparisons when no equal-amount pairs have supporting transfer evidence',()=>{
  const rows=Array.from({length:100},(_,i)=>tx({id:`row-${i}`,amount:i%2?25:-25,accountId:i%2?'bank-b':'bank-a',description:`合成普通记录 ${i}`}));
  const result=D.scanRelated(rows,{maxComparisons:37});
  assert.equal(result.length,0);assert.equal(result.truncated,true);assert.equal(result.truncatedReason,'comparison-budget');
  assert.equal(result.stats.comparisons,37);
});

test('scan budget validation and exact draft totals stay separate',()=>{
  for(const scan of [D.scan,D.scanRelated,D.scanDistinct])for(const maxComparisons of [0,-1,1.5,Infinity,NaN,'20'])assert.throws(()=>scan([],{maxComparisons}),/比较.*上限|比较.*预算/);
  const rows=Array.from({length:1000},(_,i)=>tx({id:`row-${i}`}));
  const matches=D.findMatches(tx({id:'candidate'}),rows,{maxComparisons:1});
  assert.equal(matches.total,1000);assert.equal(matches.length,20);
  const exactBudget=D.scan([tx(),tx({id:'b'}),tx({id:'unrelated',amount:-999})],{maxComparisons:1});
  assert.equal(exactBudget.truncated,false);assert.equal(exactBudget.stats.comparisons,1);
});
