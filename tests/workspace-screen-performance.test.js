const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const {JSDOM} = require('../app/node_modules/jsdom');
const {loadAssetTracker} = require('./helpers/asset-tracker-harness');

async function fixture(t) {
  const dom = new JSDOM(fs.readFileSync(require.resolve('../index.html'), 'utf8'), {url:'http://localhost'});
  const doc = dom.window.document, listen = doc.addEventListener.bind(doc);
  doc.addEventListener = (name,...args) => { if(name !== 'DOMContentLoaded') listen(name,...args); };
  const app = loadAssetTracker({document:doc,lockManager:{request:async(_name,callback)=>callback()}});
  const frames = new Map(), metrics = {fits:0,resizes:0};
  let nextFrame = 1;
  Object.assign(app.context, {
    URL:dom.window.URL,AbortController,MutationObserver:dom.window.MutationObserver,
    innerWidth:1200,innerHeight:900,
    requestAnimationFrame:callback=>{const id=nextFrame++;frames.set(id,callback);return id;},
    cancelAnimationFrame:id=>frames.delete(id),
  });
  const tracker = new app.AssetTracker();
  tracker.data=tracker.getDefaultState();tracker.setupNavigation();
  const geometry = {height:470,width:1000,chartHeight:130};
  const section=doc.getElementById('dashboard'), grid=section.querySelector('.workspace-grid');
  Object.defineProperty(section,'clientHeight',{get:()=>geometry.height,configurable:true});
  Object.defineProperty(grid,'clientWidth',{get:()=>geometry.width,configurable:true});
  doc.getElementById('normal-app-shell').getBoundingClientRect=()=>({width:geometry.width,top:0,height:900,bottom:900});
  const canvas=doc.getElementById('assetTrendChart');
  canvas.parentElement.getBoundingClientRect=()=>({width:geometry.width,height:geometry.chartHeight});
  await tracker.setupWorkspace();
  tracker.charts={trend:{canvas,resize:()=>metrics.resizes++}};
  const originalFit=tracker.fitWorkspace.bind(tracker);
  tracker.fitWorkspace=()=>{metrics.fits++;return originalFit();};
  const settle=async()=>{await Promise.resolve();await Promise.resolve();};
  async function frame() {
    await settle();const callbacks=[...frames.values()];frames.clear();
    callbacks.forEach(callback=>callback());await settle();return callbacks.length;
  }
  async function drain() {
    for(let i=0;i<10;i++){await frame();if(!frames.size)return;}
    assert.fail('workspace fit did not become idle within ten frames');
  }
  t.after(()=>{tracker.ws?.screenObserver?.disconnect();frames.clear();app.dispose();dom.window.close();});
  return {tracker,doc,app,geometry,metrics,frames,frame,drain,settle};
}

test('real MutationObserver settles after fit-owned DOM writes and burst requests share one frame',async t=>{
  const f=await fixture(t);await f.drain();
  assert.equal(f.metrics.fits,1);assert.equal(f.frames.size,0);
  for(let i=0;i<20;i++)await f.frame();
  assert.equal(f.metrics.fits,1,'idle DOM must not keep scheduling fits');
  const before=f.metrics.fits;
  for(let i=0;i<30;i++){
    f.doc.getElementById('app-status').textContent='status '+i;
    f.tracker.scheduleWorkspaceFit();
  }
  await f.drain();assert.equal(f.metrics.fits-before,1);assert.equal(f.frames.size,0);
});

test('repeating identical observed status content does not schedule twenty more layouts',async t=>{
  const f=await fixture(t);await f.drain();
  const status=f.doc.getElementById('workspace-agent-result');
  status.textContent='识别完成，请核对';await f.drain();
  const before={...f.metrics};
  for(let i=0;i<20;i++){status.textContent='识别完成，请核对';await f.drain();}
  assert.equal(f.metrics.fits-before.fits,0);
  assert.equal(f.metrics.resizes-before.resizes,0);
});

test('unchanged fits neither rewrite layout DOM nor resize unchanged charts',async t=>{
  const f=await fixture(t);await f.drain();
  const observer=new f.doc.defaultView.MutationObserver(()=>{});
  observer.observe(f.doc.documentElement,{attributes:true,childList:true,characterData:true,subtree:true});
  t.after(()=>observer.disconnect());
  const input=f.doc.getElementById('workspace-agent-input');input.focus();input.value='保留输入';
  input.setSelectionRange(1,3);
  // Focus may move the assistant to another page; establish that layout first.
  f.tracker.fitWorkspace();observer.takeRecords();const before=f.metrics.resizes;
  f.tracker.fitWorkspace();
  assert.equal(observer.takeRecords().length,0);
  assert.equal(f.metrics.resizes-before,0);
  assert.equal(f.doc.activeElement,input);assert.equal(input.value,'保留输入');
  assert.equal(input.selectionStart,1);assert.equal(input.selectionEnd,3);
});

test('real content, visibility and viewport changes still fit promptly without a loop',async t=>{
  const f=await fixture(t);await f.drain();
  const status=f.doc.getElementById('workspace-agent-result'), before=f.metrics.fits;
  status.innerHTML='<strong>需要核对</strong>';await f.drain();
  assert.equal(f.metrics.fits,before+1);
  status.hidden=true;await f.drain();
  assert.equal(f.metrics.fits,before+2);
  f.geometry.width=700;f.geometry.height=360;f.geometry.chartHeight=100;
  f.app.context.innerWidth=740;f.app.context.innerHeight=700;
  f.app.windowEvents.resize();f.app.windowEvents.resize();await f.drain();
  assert.equal(f.metrics.fits,before+3);
  assert.equal(f.tracker.ws.dashboardPlan.compact,true);
  assert.equal(f.doc.getElementById('normal-app-shell').style.height,'700px');
  assert.equal(f.frames.size,0);
});

test('a chart resized to hidden is refreshed once when its panel becomes visible again',async t=>{
  const f=await fixture(t);await f.drain();
  const before=f.metrics.resizes;
  f.geometry.chartHeight=0;f.tracker.fitWorkspace();
  assert.equal(f.metrics.resizes,before);
  f.geometry.chartHeight=130;f.tracker.fitWorkspace();
  assert.equal(f.metrics.resizes,before+1);
  f.tracker.fitWorkspace();assert.equal(f.metrics.resizes,before+1);
});
