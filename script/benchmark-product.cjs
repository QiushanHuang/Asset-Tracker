const {loadAssetTracker}=require(process.cwd()+'/tests/helpers/asset-tracker-harness');
const {JSDOM}=require(process.cwd()+'/app/node_modules/jsdom');
const {execFileSync}=require('node:child_process');
const {performance}=require('node:perf_hooks');
const fs=require('node:fs');
const vm=require('node:vm');
const reference = process.argv[2] || 'HEAD';
const baselineCommit = execFileSync('git', ['rev-parse', reference], {encoding:'utf8'}).trim();
const old=execFileSync('git',['show', baselineCommit + ':script.js'],{encoding:'utf8'});
const html=fs.readFileSync('index.html','utf8');
const results={baselineCommit,rows:3000,days:30,unit:'ms',environment:'Node VM + JSDOM; synthetic ledger; not battery or native UI measurements'};
for(const version of ['before','after']) {
 const dom=new JSDOM(html);
 const listen=dom.window.document.addEventListener.bind(dom.window.document);
 dom.window.document.addEventListener=(name,...args)=>{if(name!=='DOMContentLoaded')listen(name,...args);};
 const app=loadAssetTracker({document:dom.window.document});
 const tracker=new app.AssetTracker(); tracker.data=tracker.getDefaultState();
 tracker.data.categories={cash:{id:'cash',name:'Cash',balance:3000,currency:'CNY',isDebt:false}};
 tracker.data.transactions=Array.from({length:3000},(_,i)=>({id:String(i),date:'2026-09-'+String(1+i%18).padStart(2,'0'),amount:1,currency:'CNY',category:'Cash',description:'Benchmark',type:'单次',purpose:'其他收入'}));
 app.context.benchTracker=tracker;
 if(version==='before'){
  for(const [method,next] of [['renderTransactions','updateRecentTransactions'],['calculateDailyAssetBalance','resetCategoryBalances']]){
   const start=old.indexOf('    '+method+'('),end=old.indexOf('    '+next+'(',start);
   const body=old.slice(start,end).trim();
   vm.runInContext(`benchTracker.${method} = ({${body}}).${method}`,app.context);
  }
 }
 const start=performance.now(); tracker.renderTransactions(); const rendered=performance.now();
 const balances=tracker.calculateDailyTotals(); const calculated=performance.now();
 results[version]={renderMs:+(rendered-start).toFixed(2),trendMs:+(calculated-rendered).toFixed(2),renderedRows:dom.window.document.querySelectorAll('#transactions-tbody tr').length,latestBalance:balances.currentBalance.at(-1)};
 app.dispose(); dom.window.close();
}
console.log(JSON.stringify(results,null,2));
