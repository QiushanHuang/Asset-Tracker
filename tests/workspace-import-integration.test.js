const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs');
const {JSDOM}=require('../app/node_modules/jsdom');
const {loadAssetTracker}=require('./helpers/asset-tracker-harness');
const XLSX=require('../vendor/xlsx.full.min.js');

async function fixture(t){
  const dom=new JSDOM(fs.readFileSync(require.resolve('../index.html'),'utf8'),{url:'http://localhost'});
  const listen=dom.window.document.addEventListener.bind(dom.window.document);
  dom.window.document.addEventListener=(name,...args)=>{if(name!=='DOMContentLoaded')listen(name,...args);};
  const app=loadAssetTracker({document:dom.window.document,lockManager:{request:async(_name,callback)=>callback()}});
  Object.assign(app.context,{URL:dom.window.URL,AbortController,XLSX});
  const tracker=new app.AssetTracker();tracker.data=tracker.getDefaultState();tracker.setupNavigation();
  tracker.assertWritable=()=>{};tracker.refreshDataViews=()=>{};let saves=0;
  tracker.saveData=async()=>{saves++;};
  const cash=app.context.AssetTrackerWorkspace.accounts(tracker.data).find(account=>account.id==='cash-cny').node;cash.balance=100;
  await tracker.setupWorkspace();
  t.after(()=>{app.dispose();dom.window.close();});
  return {tracker,app,doc:dom.window.document,saves:()=>saves};
}
function spreadsheet(rows,grid=false){
  const workbook=XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(workbook,grid?XLSX.utils.aoa_to_sheet(rows):XLSX.utils.json_to_sheet(rows),'交易记录');
  return {fileName:'synthetic.xlsx',text:XLSX.write(workbook,{type:'binary',bookType:'xlsx'}),encoding:'binary'};
}
const row=extra=>({记录ID:'generic-record',日期:'2026-09-26',账户ID:'cash-cny',类别:'现金',子类别:'人民币',金额:-10,货币类型:'CNY',类型:'单次',用途分类:'餐饮美食',描述:'synthetic entry',...extra});
const cashBalance=fixture=>fixture.app.context.AssetTrackerWorkspace.accounts(fixture.tracker.data).find(account=>account.id==='cash-cny').node.balance;

test('ordinary template imports become drafts and affect the ledger only once after confirmation',async t=>{
  const f=await fixture(t);f.tracker.fileAdapter.openImport=async()=>spreadsheet([row()]);
  await f.tracker.importData();
  assert.equal(f.tracker.ws.drafts.length,1);assert.equal(f.tracker.data.transactions.length,0);assert.equal(cashBalance(f),100);assert.equal(f.saves(),0);
  const id=f.tracker.ws.drafts[0].id;
  assert.equal(await f.tracker.commitWorkspaceDrafts([id]),true);
  assert.equal(f.tracker.data.transactions[0].id,'generic-record');assert.equal(cashBalance(f),90);assert.equal(f.saves(),1);
  await f.tracker.commitWorkspaceDrafts([id]);assert.equal(f.tracker.data.transactions.length,1);assert.equal(cashBalance(f),90);
});

test('legal zero-value template records retain the upstream confirmation flow',async t=>{
  const f=await fixture(t);f.tracker.fileAdapter.openImport=async()=>spreadsheet([row({金额:0})]);
  await f.tracker.importData();
  assert.equal(f.tracker.ws.drafts.length,0);
  assert.ok(f.doc.getElementById('confirm-import-preview'));
  await f.tracker.commitImportPreview();
  assert.equal(f.tracker.data.transactions.length,1);assert.equal(f.tracker.data.transactions[0].amount,0);assert.equal(cashBalance(f),100);
});

test('template metadata outside the draft schema remains intact through the upstream preview',async t=>{
  const f=await fixture(t),input=row({记录ID:'long-id-'+ 'x'.repeat(210),日期:'2026-09-26T12:34:56',类型:'自动每月',描述:'长'.repeat(600)});
  f.tracker.fileAdapter.openImport=async()=>spreadsheet([input]);await f.tracker.importData();
  assert.equal(f.tracker.ws.drafts.length,0);assert.ok(f.doc.getElementById('confirm-import-preview'));
  await f.tracker.commitImportPreview();const saved=f.tracker.data.transactions[0];
  assert.equal(saved.id,input.记录ID);assert.equal(saved.date,input.日期);assert.equal(saved.type,input.类型);assert.equal(saved.description,input.描述);assert.equal(saved.includeTime,true);assert.equal(cashBalance(f),90);
});

for(const provider of ['wechat','alipay','icbc','ocbc'])test(`${provider} original imports keep history mode and audit through Agent confirmation`,async t=>{
  const f=await fixture(t);
  let input;
  if(provider==='wechat')input=spreadsheet([
    ['交易时间','交易类型','交易对方','商品','收/支','金额(元)','支付方式','当前状态','交易单号','商户单号','备注'],
    ['2026-09-19 12:03:04','商户消费','合成商户','午餐','支出',10,'零钱','支付成功','wx-integrated','merchant-1','/']
  ],true);
  else if(provider==='alipay')input=spreadsheet([
    ['交易时间','交易分类','交易对方','对方账号','商品说明','收/支','金额','收/付款方式','交易状态','交易订单号','商家订单号','备注'],
    ['2026-09-19 14:15:16','餐饮美食','合成商户','test***','午餐','支出',10,'账户余额','交易成功','ali-integrated','merchant-1','/']
  ],true);
  else{
    input={fileName:'synthetic.pdf',text:'%PDF-synthetic-dispatch-boundary',encoding:'binary'};
    f.app.context.AssetTrackerBankImport={read:async()=>({provider,fileName:input.fileName,total:1,skipped:[],errors:[],methods:[{name:'bank-cash',count:1,currency:'CNY'}],records:[{row:1,date:'2026-09-19',amount:-10,currency:'CNY',id:provider+':integrated',source:{version:1,transactionId:'integrated',merchantId:'',transactionType:'DEBIT PURCHASE',counterparty:'',product:'synthetic purchase',direction:'支出',paymentMethod:'bank-cash',status:'已入账',note:'',timezone:'source-local',signature:JSON.stringify(['2026-09-19','支出',1000])}}]})};
  }
  f.tracker.fileAdapter.openImport=async()=>input;
  f.tracker.queueWorkspaceImport=()=>{throw Error('original statement must use its audited importer');};
  let reviewed=false;
  f.app.context.AssetTrackerWechatUI.open=async({parsed,getBook,onCommit})=>{
    reviewed=true;assert.equal(parsed.provider,provider);assert.equal(getBook().transactions.length,0);
    const importer=f.app.context.AssetTrackerWechatImport,mapping=Object.fromEntries(parsed.methods.map(method=>[method.name,'cash-cny']));
    const preview=importer.prepare(getBook(),parsed,mapping);assert.equal(preview.errors.length,0);
    await onCommit(importer.apply(getBook(),preview));
  };
  await f.tracker.importData();
  assert.equal(reviewed,true);assert.equal(f.tracker.data.transactions.length,1);assert.equal(cashBalance(f),100);
  const imported=f.tracker.data.transactions[0];assert.equal(imported[provider].balanceMode,'history');
  assert.equal(f.tracker.data.importAudits[0].provider,provider);assert.equal(f.tracker.data.importAudits[0].items[0].decision,'imported');
  const audit=JSON.stringify(f.tracker.data.importAudits);
  f.tracker.ws.drafts=[{id:'agent-after-import',source:'assistant',status:'pending',proposal:{date:'2026-09-26',amount:'5',direction:'expense',currency:'CNY',accountId:'cash-cny',purpose:'餐饮美食',description:'new confirmed purchase',projectId:'',expenseCategoryId:''}}];
  f.tracker.ws.reviewBasis=JSON.stringify(f.tracker.data);
  assert.equal(await f.tracker.commitWorkspaceDrafts(['agent-after-import']),true);
  assert.equal(cashBalance(f),95);assert.equal(JSON.stringify(f.tracker.data.importAudits),audit);
  f.tracker.updateCategoryBalance({...imported,amount:-999});assert.equal(cashBalance(f),95);
});
