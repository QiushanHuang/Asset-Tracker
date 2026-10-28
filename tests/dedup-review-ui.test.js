const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('../app/node_modules/jsdom'),{loadAssetTracker}=require('./helpers/asset-tracker-harness');
async function fixture(t){const dom=new JSDOM(fs.readFileSync(require.resolve('../index.html'),'utf8'),{url:'http://localhost'});const listen=dom.window.document.addEventListener.bind(dom.window.document);dom.window.document.addEventListener=(n,...a)=>{if(n!=='DOMContentLoaded')listen(n,...a);};const app=loadAssetTracker({document:dom.window.document,lockManager:{request:async(_n,f)=>f()}});app.context.URL=dom.window.URL;app.context.AbortController=AbortController;const tracker=new app.AssetTracker();tracker.data=tracker.getDefaultState();tracker.setupNavigation();await tracker.setupWorkspace();t.after(()=>{app.dispose();dom.window.close();});return {tracker,doc:dom.window.document,app};}
const row=(id,more={})=>({id,date:'2026-10-01T12:30:00',amount:-32,currency:'CNY',accountId:'cash-cny',category:'现金',subcategory:'人民币',description:'午餐',purpose:'餐饮美食',...more});

test('comparison aligns both records, marks differences, escapes content and never writes',async t=>{
 const {tracker,doc}=await fixture(t);tracker.data.transactions=[row('a',{description:'<午餐>'}),row('b',{description:'<午餐>',purpose:'其他支出'})];const before=JSON.stringify(tracker.data);let writes=0;tracker.saveData=async()=>{writes++;};
 tracker.showWorkspaceDuplicates();const table=doc.querySelector('.ws-compare-table');assert.ok(table);assert.match(table.textContent,/现金 \/ 人民币/);assert.ok(table.querySelector('[data-field="purpose"]').classList.contains('is-different'));assert.equal(table.querySelector('午餐'),null);
 assert.equal(doc.querySelector('[data-delete-transaction]'),null);assert.equal(JSON.stringify(tracker.data),before);assert.equal(writes,0);
 const diff=doc.getElementById('ws-dup-differences');diff.checked=true;diff.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));assert.equal(doc.querySelector('[data-field="currency"]').hidden,true);assert.equal(doc.querySelector('[data-field="purpose"]').hidden,false);
});
test('opening a source and returning preserves comparison selection and page',async t=>{
 const {tracker,doc}=await fixture(t);tracker.data.transactions=Array.from({length:30},(_,i)=>[row('a'+i,{amount:-i-1,description:'事项'+i,reviewSource:{text:'原始来源'+i}}),row('b'+i,{amount:-i-1,description:'事项'+i})]).flat();
 tracker.showWorkspaceDuplicates();doc.getElementById('ws-dup-next').click();const key=tracker.ws.duplicateView.selectedKey;assert.equal(tracker.ws.duplicateView.page,1);
 doc.querySelector('[data-dup-record="left"]').click();assert.match(doc.getElementById('modal-body').textContent,/原始来源/);doc.getElementById('ws-dup-back').click();assert.equal(tracker.ws.duplicateView.selectedKey,key);assert.equal(tracker.ws.duplicateView.page,1);
});
test('a changed comparison scope refuses old navigation and can refresh',async t=>{
 const {tracker,doc}=await fixture(t);tracker.data.transactions=[row('a'),row('b')];tracker.showWorkspaceDuplicates();tracker.data.transactions[1].amount=-77;
 doc.querySelector('[data-dup-record="left"]').click();assert.match(doc.getElementById('ws-dup-status').textContent,/变化|重新/);doc.getElementById('ws-dup-refresh').click();assert.match(doc.getElementById('modal-body').textContent,/没有|未发现/);
});
test('draft evidence opens the specific pair and returns without discarding edits',async t=>{
 const {tracker,doc}=await fixture(t);tracker.data.transactions=[row('saved')];await tracker.recognizeWorkspaceText('2026-10-01 午餐支出32元，现金 / 人民币');const draft=tracker.ws.drafts[0];tracker.ws.focusId=draft.id;tracker.renderWorkspaceReview();
 const amount=doc.getElementById('ws-draft-amount');const compare=doc.querySelector('[data-ws-action="compare-draft"]');assert.ok(compare);compare.click();assert.ok(doc.querySelector('.ws-compare-table'));doc.getElementById('ws-dup-return-draft').click();assert.equal(tracker.ws.focusId,draft.id);assert.equal(doc.getElementById('ws-draft-amount').value,amount.value);assert.equal(draft.status,'pending');
});
test('bank distinctions and funds flow use separate views without duplicate actions',async t=>{
 const {tracker,doc}=await fixture(t);const bank={accountFingerprint:'synthetic-account',bankBalanceCents:9000,sourcePage:1,sourceRow:1,transactionId:'hash-a',product:'餐饮'};
 tracker.data.transactions=[row('bank-a',{icbc:bank}),row('bank-b',{icbc:{...bank,transactionId:'hash-b',bankBalanceCents:5800,sourceRow:2}}),row('transfer-out',{amount:-12,description:'转账',date:'2026-10-01T10:00:00'}),row('transfer-in',{amount:12,accountId:'alipay-wallet',description:'转入',date:'2026-10-01T10:00:30'})];
 tracker.showWorkspaceDuplicates();assert.equal(tracker.ws.duplicateView.counts.duplicate,0);assert.equal(tracker.ws.duplicateView.counts.distinct,1);assert.ok(tracker.ws.duplicateView.counts.related>=1);
 const select=doc.getElementById('ws-dup-kind');select.value='distinct';select.dispatchEvent(new doc.defaultView.Event('change',{bubbles:true}));assert.match(doc.getElementById('modal-body').textContent,/账后余额/);assert.ok(doc.querySelector('.ws-dup-chain'));
});
test('a matching platform order is not labelled as bank balance evidence',async t=>{
 const {tracker,doc}=await fixture(t);tracker.data.transactions=[row('a',{wechat:{transactionId:'001'}}),row('b',{wechat:{transactionId:'001'}})];tracker.showWorkspaceDuplicates();assert.equal(doc.querySelector('.ws-dup-chain'),null);assert.equal(doc.querySelector('#modal-body h3').id,'modal-title');
});
test('returning to a draft cannot cross a changed book scope',async t=>{
 const {tracker,doc}=await fixture(t);tracker.data.transactions=[row('saved')];await tracker.recognizeWorkspaceText('2026-10-01 午餐支出32元，现金 / 人民币');const d=tracker.ws.drafts[0];tracker.openWorkspaceDraftComparison(d.id,'saved');
 tracker.data.workspaceScope='another-book';tracker.ws.scope='another-book';let navigations=0;tracker.openWorkspaceSection=()=>navigations++;
 doc.getElementById('ws-dup-return-draft').click();assert.equal(navigations,0);assert.match(doc.getElementById('ws-dup-status').textContent,/变化|重新/);
 doc.getElementById('ws-dup-refresh').click();assert.equal(doc.getElementById('ws-dup-return-draft'),null);
});
test('comparison displays verified legacy aliases and space-delimited time consistently',async t=>{
 const {tracker,doc}=await fixture(t);const leaf=tracker.findCategoryById('cash-cny');leaf.sourceCategoryId='old-cash';
 const a=row('a',{accountId:undefined,sourceCategoryId:'old-cash',date:'2026-10-01 12:30:00'}),b=row('b');tracker.data.transactions=[a,b];tracker.showWorkspaceDuplicates();
 assert.match(doc.querySelector('[data-field="account"]').textContent,/现金 \/ 人民币/);assert.equal(doc.querySelector('[data-field="account"]').classList.contains('is-different'),false);assert.equal(doc.querySelector('[data-field="precision"]').classList.contains('is-different'),false);
});
test('unqualified statement references are not presented as verified source identity',async t=>{
 const {tracker,doc}=await fixture(t);tracker.data.transactions=[row('a',{sourceIdentity:{provider:'statement',id:'001'}}),row('b')];tracker.showWorkspaceDuplicates();assert.match(doc.querySelector('[data-field="identity-kind"]').textContent,/未明确|不作身份/);
});
