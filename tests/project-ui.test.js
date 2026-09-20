const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('../app/node_modules/jsdom');
const {loadAssetTracker}=require('./helpers/asset-tracker-harness');
const P=require('../expense-projects');
function fixture(t){
 const dom=new JSDOM(fs.readFileSync(require.resolve('../index.html'),'utf8'));
 const listen=dom.window.document.addEventListener.bind(dom.window.document);
 dom.window.document.addEventListener=(name,...args)=>{if(name!=='DOMContentLoaded')listen(name,...args);};
 const app=loadAssetTracker({document:dom.window.document});const tracker=new app.AssetTracker();
 tracker.data=tracker.getDefaultState();tracker.data.expenseProjects=[P.createProject('测试旅行',true)];
 t.after(()=>{app.dispose();dom.window.close();});return {tracker,doc:dom.window.document,dom};
}
test('new entry defaults to the active project and exposes only its category tree',t=>{
 const {tracker,doc}=fixture(t);tracker.activeProjectId=tracker.data.expenseProjects[0].id;
 tracker.showTransactionModal();assert.equal(doc.getElementById('entry-project').value,tracker.activeProjectId);
 assert.ok(doc.getElementById('expense-level-1').textContent.includes('餐饮'));
 assert.equal(doc.getElementById('expense-level-2').hidden,true);
});
test('editing an old record does not silently assign the active project',t=>{
 const {tracker,doc}=fixture(t);tracker.activeProjectId=tracker.data.expenseProjects[0].id;
 tracker.data.transactions=[{id:'old',date:'2026-04-01',category:'现金',subcategory:'人民币',amount:-5,currency:'CNY',type:'单次',purpose:'餐饮美食',description:'old'}];
 tracker.editTransaction('old');assert.equal(doc.getElementById('entry-project').value,'');
});
test('project changes clear stale category selection',t=>{
 const {tracker,doc}=fixture(t);const second=P.createProject('另一次旅行',false);tracker.data.expenseProjects.push(second);
 tracker.activeProjectId=tracker.data.expenseProjects[0].id;tracker.showTransactionModal();
 doc.getElementById('expense-level-1').value=tracker.data.expenseProjects[0].categories[0].id;
 tracker.updateExpenseLevels(1);
 doc.getElementById('entry-project').value=second.id;tracker.updateEntryProject();
 assert.equal(tracker.readProjectEntry().expenseCategoryId,null);
});
test('positive input with expense direction records a negative amount',async t=>{
 const {tracker,doc}=fixture(t);tracker.showTransactionModal();
 doc.getElementById('transaction-amount').value='25';doc.getElementById('transaction-category').value='现金';doc.getElementById('transaction-subcategory').value='人民币';doc.getElementById('transaction-purpose').value='餐饮美食';
 tracker.persistData=async()=>{};tracker.updateDashboard=()=>{};await tracker.submitTransaction();
 assert.equal(tracker.data.transactions[0].amount,-25);
});
test('saving project metadata does not mutate transaction balances or legacy references',async t=>{
 const {tracker,doc}=fixture(t);const before=JSON.stringify(tracker.data.categories);tracker.showProjectEditor();
 doc.getElementById('project-name').value='新的旅行';tracker.persistData=async()=>{};
 await tracker.saveProjectEditor();assert.equal(tracker.data.expenseProjects.length,2);assert.equal(JSON.stringify(tracker.data.categories),before);
});
test('invalid fourth-level category cannot be saved',async t=>{
 const {tracker,doc}=fixture(t);const p=tracker.data.expenseProjects[0];const parent=p.categories.find(n=>n.parentId);p.categories.push({id:'third',name:'第三层',parentId:parent.id});tracker.projectViewId=p.id;
 tracker.showExpenseCategoryEditor(null,'third');doc.getElementById('expense-category-name').value='第四层';let saved=false;tracker.persistData=async()=>{saved=true;};
 await tracker.saveExpenseCategoryEditor();assert.equal(saved,false);assert.match(doc.getElementById('project-form-error').textContent,/三级/);
});
test('malicious project and category names remain plain text',t=>{
 const {tracker,doc}=fixture(t);tracker.data.expenseProjects[0].name='<img src=x onerror=alert(1)>';tracker.projectViewId=tracker.data.expenseProjects[0].id;
 tracker.renderProjectWorkspace();assert.equal(doc.querySelector('#projects img'),null);assert.match(doc.getElementById('projects').textContent,/<img/);
});
test('save and continue keeps project/account/category but clears amount only after confirmed save',async t=>{
 const {tracker,doc}=fixture(t);tracker.activeProjectId=tracker.data.expenseProjects[0].id;tracker.showTransactionModal();
 doc.getElementById('transaction-category').value='现金';doc.getElementById('transaction-subcategory').value='人民币';doc.getElementById('transaction-purpose').value='餐饮美食';doc.getElementById('transaction-amount').value='12';
 let resolve;tracker.persistData=()=>new Promise(r=>{resolve=r;});tracker.updateDashboard=()=>{};
 const promise=tracker.submitTransaction(true);assert.equal(doc.getElementById('transaction-amount').value,'12');resolve();await promise;
 assert.equal(doc.getElementById('transaction-amount').value,'');assert.equal(doc.getElementById('entry-project').value,tracker.activeProjectId);assert.equal(doc.getElementById('modal').style.display,'block');
});

test('assigning an old bill to a project preserves amount, account balance and identity',async t=>{
 const {tracker,doc}=fixture(t);const item={id:'old',date:'2026-04-01',category:'现金',subcategory:'人民币',amount:-5,currency:'CNY',type:'单次',purpose:'餐饮美食',description:'old'};
 tracker.data.transactions=[item];const before=JSON.stringify(tracker.data.categories);tracker.editTransaction('old');
 doc.getElementById('entry-project').value=tracker.data.expenseProjects[0].id;tracker.updateEntryProject();
 doc.getElementById('expense-level-1').value=tracker.data.expenseProjects[0].categories[0].id;
 tracker.persistData=async()=>{};tracker.updateDashboard=()=>{};await tracker.updateTransaction('old');
 assert.equal(tracker.data.transactions.length,1);assert.equal(item.id,'old');assert.equal(item.amount,-5);assert.equal(item.projectId,tracker.data.expenseProjects[0].id);assert.equal(JSON.stringify(tracker.data.categories),before);
});
test('same-named leaf accounts resolve through stable account ID',t=>{
 const {tracker}=fixture(t);
 tracker.data.categories={root:{id:'root',name:'银行',children:{a:{id:'first',name:'同名',balance:100,currency:'CNY'},b:{id:'second',name:'同名',balance:200,currency:'CNY'}}}};
 tracker.updateCategoryBalance({category:'银行',subcategory:'同名',accountId:'second',amount:-5,currency:'CNY'});
 assert.equal(tracker.data.categories.root.children.a.balance,100);assert.equal(tracker.data.categories.root.children.b.balance,195);
 const copy=JSON.parse(JSON.stringify(tracker.data.categories));tracker.subtractTransactionFromBalance(copy,{category:'银行',subcategory:'同名',accountId:'second',amount:-5,currency:'CNY'});
 assert.equal(copy.root.children.b.balance,200);
});
test('project and category filters retain only descendant transactions',t=>{
 const {tracker,doc}=fixture(t);const p=tracker.data.expenseProjects[0],food=p.categories[0],child=p.categories.find(n=>n.parentId===food.id);
 tracker.data.transactions=[{id:'one',date:'2026-09-19',category:'现金',amount:-1,projectId:p.id,expenseCategoryId:child.id},{id:'two',date:'2026-09-19',category:'现金',amount:-2}];
 tracker.renderProjectSelectors();doc.getElementById('project-filter').value=p.id;tracker.renderProjectSelectors();doc.getElementById('project-category-filter').value=food.id;tracker.renderTransactions();
 assert.equal(doc.querySelectorAll('#transactions-tbody tr').length,1);assert.match(doc.getElementById('transactions-tbody').textContent,/测试旅行/);
});
test('project save failures never report success or allow a second write',async t=>{
 const {tracker,doc}=fixture(t);tracker.showProjectEditor();doc.getElementById('project-name').value='失败项目';
 let writes=0;tracker.persistData=async()=>{writes++;throw new Error('disk');};let success=false;tracker.showMessage=(text,type)=>{if(type==='success')success=true;};
 await tracker.saveProjectEditor();await tracker.saveProjectEditor();assert.equal(writes,1);assert.equal(success,false);assert.match(doc.getElementById('project-form-error').textContent,/保存未确认/);
});

test('expense on a stable-ID debt account increases what is owed and reverses correctly',t=>{
 const {tracker}=fixture(t);tracker.data.categories={debt:{id:'debt',name:'信用卡',balance:100,currency:'CNY',isDebt:true}};
 const expense={category:'信用卡',subcategory:'',accountId:'debt',amount:-25,currency:'CNY'};
 tracker.updateCategoryBalance(expense);assert.equal(tracker.data.categories.debt.balance,125);assert.equal(tracker.calculateTotals().totalAssets,-125);
 const historic=JSON.parse(JSON.stringify(tracker.data.categories));tracker.subtractTransactionFromBalance(historic,expense);assert.equal(historic.debt.balance,100);
 tracker.updateCategoryBalance({...expense,amount:25});assert.equal(tracker.data.categories.debt.balance,100);
});
