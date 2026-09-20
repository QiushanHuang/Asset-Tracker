const test=require('node:test');
const assert=require('node:assert/strict');
const P=require('../expense-projects');
const project=()=>({id:'trip',name:'旅行',archived:false,categories:[{id:'food',name:'餐饮',parentId:null},{id:'meal',name:'正餐',parentId:'food'},{id:'dinner',name:'晚餐',parentId:'meal'},{id:'hotel',name:'住宿',parentId:null}]});
const state=()=>({expenseProjects:[project()],transactions:[],settings:{baseCurrency:'CNY',exchangeRates:{CNY:1,USD:7}}});
test('three category levels are allowed, fourth level is rejected',()=>{
 const s=state();assert.deepEqual(P.validate(s),[]);
 s.expenseProjects[0].categories.push({id:'four',name:'四层',parentId:'dinner'});
 assert.ok(P.validate(s).some(x=>x.includes('三级')));
});
test('cycles, missing parents, duplicate IDs and same-level names fail closed',()=>{
 for(const entry of [{id:'food',name:'duplicate',parentId:null},{id:'bad',name:'餐饮',parentId:null},{id:'bad',name:'bad',parentId:'missing'}]){
  const s=state();s.expenseProjects[0].categories.push(entry);assert.ok(P.validate(s).length);
 }
 const s=state();s.expenseProjects[0].categories[0].parentId='dinner';assert.ok(P.validate(s).length);
});
test('cross-project and dangling transaction references are rejected',()=>{
 for(const t of [{projectId:'missing'}, {projectId:'trip',expenseCategoryId:'missing'}, {expenseCategoryId:'food'}]){
  const s=state();s.transactions=[t];assert.ok(P.validate(s).length);
 }
});
test('old books without project metadata remain valid and unassigned',()=>{
 const s=state();delete s.expenseProjects;s.transactions=[{id:'old',amount:-12,purpose:'餐饮美食'}];assert.deepEqual(P.validate(s),[]);
 assert.equal(P.matches(s,s.transactions[0],'__daily',''),true);
});
test('aggregate each descendant exactly once, retain direct and unclassified records',()=>{
 const s=state();s.transactions=[
  {projectId:'trip',expenseCategoryId:'food',amount:-10,currency:'CNY'},
  {projectId:'trip',expenseCategoryId:'dinner',amount:-20,currency:'CNY'},
  {projectId:'trip',expenseCategoryId:'hotel',amount:-100,currency:'CNY'},
  {projectId:'trip',expenseCategoryId:null,amount:-5,currency:'CNY'},
  {projectId:'trip',expenseCategoryId:'food',amount:7,currency:'CNY'},
  {amount:-999,currency:'CNY'}];
 const root=P.summarize(s,'trip');assert.equal(root.expense,135);assert.equal(root.income,7);assert.equal(root.count,5);
 assert.equal(root.rows.find(x=>x.id==='food').expense,30);
 const food=P.summarize(s,'trip','food');assert.equal(food.expense,30);assert.equal(food.rows.find(x=>x.id==='__direct').expense,10);
 assert.equal(food.rows.reduce((n,x)=>n+x.expense,0),30);
});
test('unknown currency is disclosed instead of converted at 1:1',()=>{
 const s=state();s.transactions=[{projectId:'trip',amount:-8,currency:'EUR'},{projectId:'trip',amount:-2,currency:'USD'}];
 const a=P.summarize(s,'trip');assert.equal(a.expense,14);assert.deepEqual(a.unconverted,{EUR:{expense:8,income:0,count:1}});
});
test('project and descendant filters do not include unrelated projects',()=>{
 const s=state();assert.equal(P.matches(s,{projectId:'trip',expenseCategoryId:'dinner'},'trip','food'),true);
 assert.equal(P.matches(s,{projectId:'else',expenseCategoryId:'dinner'},'trip','food'),false);
 assert.equal(P.matches(s,{projectId:'trip',expenseCategoryId:null},'trip','__unclassified'),true);
});
test('rename preserves stable references and full path',()=>{
 const s=state();s.expenseProjects[0].categories[0].name='吃饭';assert.equal(P.path(s.expenseProjects[0],'dinner'),'吃饭 / 正餐 / 晚餐');
});
test('travel templates have independent IDs and valid three-level structure',()=>{
 const a=P.createProject('A',true),b=P.createProject('B',true);assert.notEqual(a.id,b.id);
 const ids=new Set(a.categories.map(x=>x.id));assert.ok(b.categories.every(x=>!ids.has(x.id)));
 assert.deepEqual(P.validate({expenseProjects:[a,b],transactions:[]}),[]);
});
test('used categories and parents with descendants cannot be deleted',()=>{
 const s=state();assert.equal(P.canDelete(s,'trip','food'),false);
 assert.equal(P.canDelete(s,'trip','hotel'),true);
 s.transactions=[{projectId:'trip',expenseCategoryId:'hotel'}];assert.equal(P.canDelete(s,'trip','hotel'),false);
});

test('persistence validator rejects invalid project trees and dangling references',()=>{
 const safety=require('../legacy-safety');const s=state();s.categories={};s.transactions=[];
 s.expenseProjects[0].categories.push({id:'four',name:'四层',parentId:'dinner'});
 assert.equal(safety.validateBookText(JSON.stringify(s)).status,'corrupt');
});

test('JSON export/import round-trip preserves projects, category identities and old transactions',()=>{
 const safety=require('../legacy-safety');const s=state();s.categories={};s.transactions=[{id:'t',date:'2026-09-19',category:'现金',amount:-5,projectId:'trip',expenseCategoryId:'dinner'}];
 const result=safety.validateBookText(JSON.stringify({format:'qiushan.asset-book',schemaVersion:1,formatVersion:1,payload:s}));
 assert.equal(result.status,'valid');assert.deepEqual(result.payload.expenseProjects,s.expenseProjects);assert.deepEqual(result.payload.transactions,s.transactions);
});
test('malformed metadata returns validation errors rather than throwing or accepting',()=>{
 const safety=require('../legacy-safety');
 for(const fields of [{expenseProjects:{}},{expenseProjects:[null]},{expenseProjects:[{id:'x',name:'x',archived:false,categories:[null]}]},{transactions:[{id:'t',date:'2026-09-19',category:'现金',amount:-1,projectId:0}]}]){
  assert.equal(safety.validateBookText(JSON.stringify({categories:{},...fields})).status,'corrupt');
 }
});
