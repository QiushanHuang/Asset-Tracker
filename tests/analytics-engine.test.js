const test=require('node:test'),assert=require('node:assert/strict');
const A=require('../ledger-insights');
const state=()=>({categories:{cash:{id:'cash',name:'现金',balance:120,currency:'CNY'},card:{id:'card',name:'信用卡',balance:30,currency:'CNY',isDebt:true}},transactions:[{id:'one',date:'2026-01-02T12:00:00',category:'现金',accountId:'cash',amount:20,currency:'CNY',purpose:'工资'}],initialAssets:[],automationRules:[],settings:{baseCurrency:'CNY',exchangeRates:{CNY:1,USD:7}},expenseProjects:[]});
test('historical reverse projection and debt totals agree with current balances',()=>{
 const s=state();const x=A.snapshot(s,{asOf:'2026-01-03',compareAt:'2026-01-01',trendDays:3,forecastDays:7,basis:'current'});
 assert.equal(x.current.net,90);assert.equal(x.compare.net,70);assert.equal(x.trend.length,3);assert.equal(x.trend.at(-1).net,90);
});
test('anchors take effect at their timestamp and include later transactions only',()=>{
 const s=state();s.initialAssets=[{id:'a',category:'现金',time:'2026-01-02T10:00:00',amount:50,currency:'CNY'}];
 const x=A.snapshot(s,{asOf:'2026-01-03',compareAt:'2026-01-01',basis:'anchors',trendDays:3});assert.equal(x.current.asset,70);assert.equal(x.compare.asset,100);assert.equal(x.anchors.length,1);
});
test('historical rates use latest eligible value, never a future rate',()=>{
 const s=state();s.categories={usd:{id:'usd',name:'USD',currency:'USD',balance:10}};s.transactions=[];
 s.settings.exchangeRateHistory=[{currency:'USD',baseCurrency:'CNY',effectiveFrom:'2026-01-01',rate:6},{currency:'USD',baseCurrency:'CNY',effectiveFrom:'2026-02-01',rate:8}];
 const x=A.snapshot(s,{asOf:'2026-01-15',compareAt:'2025-12-01',rateMode:'historical'});assert.equal(x.current.net,60);assert.deepEqual(x.compare.missing,['USD']);
});
test('unknown currency stays unresolved and never contributes at rate one',()=>{
 const s=state();s.categories.x={id:'x',name:'Euro',currency:'EUR',balance:10};
 const x=A.snapshot(s,{asOf:'2026-01-03',compareAt:'2026-01-01'});assert.equal(x.current.net,90);assert.deepEqual(x.current.missing,['EUR']);
});
test('cashflow separates income from expense and counts every date including zero days',()=>{
 const s=state();s.transactions.push({date:'2026-01-03',category:'现金',amount:-5,currency:'CNY',purpose:'餐饮'});
 const x=A.snapshot(s,{asOf:'2026-01-03',trendDays:3});assert.deepEqual(x.cashflow.map(p=>[p.income,p.expense]),[[0,0],[20,0],[0,5]]);
 assert.equal(x.spending.find(p=>p.name==='餐饮').amount,5);
});
test('forecast is deterministic and monthly occurrences clamp to month end',()=>{
 const s=state();s.transactions=[];s.automationRules=[{id:'r',name:'月费',category:'现金',amount:-10,currency:'CNY',active:true,frequency:'monthly',startDate:'2026-01-31'}];
 const input={asOf:'2026-02-01',forecastDays:30,trendDays:3};const a=A.snapshot(s,input),b=A.snapshot(s,input);
 assert.deepEqual(a.forecast,b.forecast);assert.equal(a.forecast.at(-1).net,80);assert.equal(a.occurrences.length,1);assert.equal(a.occurrences[0].date,'2026-02-28');
});
test('inactive, expired and already-recorded rule occurrences are excluded',()=>{
 const s=state();s.automationRules=[{id:'off',active:false,category:'现金',amount:-99,frequency:'daily',startDate:'2026-01-01'},{id:'r',name:'日费',active:true,category:'现金',amount:-2,frequency:'daily',startDate:'2026-01-01',endDate:'2026-01-05'}];
 s.transactions.push({date:'2026-01-04',category:'现金',amount:-2,sourceAutomationRuleId:'r'});
 const x=A.snapshot(s,{asOf:'2026-01-03',forecastDays:7});assert.deepEqual(x.occurrences.map(p=>p.date),['2026-01-05']);
});
test('hypothesis scenarios support daily amount, daily growth, target and monthly compound without mutating ledger',()=>{
 const s=state(),before=JSON.stringify(s);
 assert.deepEqual(A.scenario(100,2,{type:'linear',value:-5}),[100,95,90]);
 assert.deepEqual(A.scenario(100,2,{type:'percentage',value:10}),[100,110,121]);
 assert.deepEqual(A.scenario(100,2,{type:'fixed',value:80}),[100,80,80]);
 assert.ok(Math.abs(A.scenario(100,30,{type:'compound',value:10}).at(-1)-110)<0.01);
 A.snapshot(s,{asOf:'2026-01-03'});assert.equal(JSON.stringify(s),before);
});
test('composition keeps liabilities separate and pie never takes absolute net as asset',()=>{
 const x=A.snapshot(state(),{asOf:'2026-01-03'});assert.equal(x.assetComposition.reduce((n,p)=>n+p.amount,0),120);assert.equal(x.debtComposition.reduce((n,p)=>n+p.amount,0),30);
 assert.ok(x.radar.every(p=>p.value>=0 && p.value<=100));
});
test('invalid dates and rates fail with useful errors',()=>{
 assert.throws(()=>A.snapshot(state(),{asOf:'2026-02-31'}),/日期/);
 assert.throws(()=>A.validateRate({currency:'USD',baseCurrency:'CNY',effectiveFrom:'2026-01-01',rate:0}),/汇率/);
});
test('invalid persisted rate history is rejected by the book validator',()=>{const safety=require('../legacy-safety');const s=state();s.settings.exchangeRateHistory=[{currency:'USD',baseCurrency:'CNY',rate:0,effectiveFrom:'2026-01-01'}];assert.equal(safety.validateBookText(JSON.stringify(s)).status,'corrupt');});
test('debt spending in a stable account increases forecast liabilities',()=>{const s=state();s.automationRules=[{id:'r',name:'信用卡',active:true,accountId:'card',category:'信用卡',amount:-10,currency:'CNY',frequency:'daily',startDate:'2026-01-04',endDate:'2026-01-04'}];const x=A.snapshot(s,{asOf:'2026-01-03',forecastDays:2});assert.equal(x.forecast.at(-1).debt,40);assert.equal(x.forecast.at(-1).net,80);});
test('overflowing scenarios fail explicitly instead of returning infinity',()=>{assert.throws(()=>A.scenario(100,90,{type:'percentage',value:1e100}),/超出/);});
test('foreign account balances retain precision until final base-currency rounding',()=>{const s=state();s.categories={fx:{id:'fx',name:'FX',balance:100/7,currency:'USD'}};s.transactions=[];const x=A.snapshot(s,{asOf:'2026-01-03'});assert.equal(x.current.net,100);});
