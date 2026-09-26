const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),path=require('node:path');
const P=fs.existsSync(path.join(__dirname,'../agent-provider.js'))?require('../agent-provider'):{};
const connection={provider:'ollama',location:'device',baseURL:'http://127.0.0.1:11434',model:'example-small',enabled:true,allowText:true,allowExamples:false};
test('connections restrict schemes, credentials and destinations; secrets are not persisted',()=>{
  assert.equal(typeof P.connection,'function');assert.equal(P.connection({...connection,apiKey:'secret'}).apiKey,undefined);
  for(const url of ['file:///etc/passwd','http://192.168.1.2','http://user:pass@localhost:11434','http://localhost:11434?x=y'])assert.throws(()=>P.connection({...connection,baseURL:url}));
  assert.throws(()=>P.connection({...connection,location:'cloud',baseURL:'https://127.0.0.1'}));
});
test('minimal task payload excludes full ledger and requires explicit task permission',()=>{
  assert.equal(typeof P.request,'function');const context={today:'2026-09-26',accounts:[{id:'a',name:'现金',currency:'CNY',balance:999}],purposes:['餐饮'],projects:[],transactions:[{private:true}]};
  const r=P.request(connection,'parse-entry','午餐32元',context);
  assert.equal(r.path,'/api/chat');assert.equal(r.body.stream,false);assert.ok(!JSON.stringify(r).includes('999'));assert.ok(!JSON.stringify(r).includes('private'));
  assert.throws(()=>P.request({...connection,allowText:false},'parse-entry','午餐',context),/授权/);
});
test('both provider protocols decode strict structured proposals and reject malformed responses',()=>{
  assert.equal(typeof P.decode,'function');const result={date:'2026-09-26',amount:'32.00',direction:'expense',currency:'CNY',accountId:'a',purpose:'餐饮',description:'午餐',projectId:'',expenseCategoryId:''};
  assert.deepEqual(P.decode('ollama',{message:{content:JSON.stringify(result)}}),result);
  assert.deepEqual(P.decode('compatible',{choices:[{message:{content:JSON.stringify(result)}}]}),result);
  assert.throws(()=>P.decode('ollama',{message:{content:'not json'}}),/结构/);
});
test('cancel and timeout stop delivery; HTTP errors produce actionable failure',async()=>{
  assert.equal(typeof P.send,'function');const request={url:'http://127.0.0.1:11434/api/chat',method:'POST',body:{}};
  await assert.rejects(()=>P.send(request,{fetch:async()=>({ok:false,status:401}),timeoutMs:50}),/401/);
  await assert.rejects(()=>P.send(request,{fetch:(_u,{signal})=>new Promise((_r,j)=>signal.addEventListener('abort',()=>j(new Error('abort')))),timeoutMs:5}),/超时/);
  const controller=new AbortController();controller.abort();await assert.rejects(()=>P.send(request,{signal:controller.signal,fetch:async()=>{throw Error('must not call');}}),/取消/);
});
test('short Ollama extraction tasks bound extra thinking and permit model-default fallback',()=>{
  const context={today:'2026-09-26',accounts:[],purposes:[],projects:[]};
  assert.equal(P.request(connection,'parse-entry','午餐32元',context).body.think,false);
  assert.equal(P.request({...connection,thinking:'default'},'parse-entry','午餐32元',context).body.think,undefined);
});
