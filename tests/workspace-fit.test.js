const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const filename = path.join(__dirname, '../workspace-fit.js');
const fit = fs.existsSync(filename) ? require(filename) : {};

const defaults = [
  {id:'cashflow',width:'full'}, {id:'assets',width:'full'},
  {id:'trend',width:'wide'}, {id:'review',width:'narrow'},
  {id:'recent',width:'wide'}, {id:'automation',width:'narrow'},
  {id:'assistant',width:'full'}
];
const allModules = [...defaults,
  {id:'allocation',width:'half'}, {id:'projects',width:'half'}, {id:'memo',width:'full'}
];
const ids = result => result.pages.flatMap(page => page.items.map(item => item.id));
const usedHeight = (page,gap) => page.rows.reduce((sum,height) => sum+height,0) + Math.max(0,page.rows.length-1)*gap;
function plan(modules,options) {
  assert.equal(typeof fit.plan,'function','layout planner is available');
  return fit.plan(modules,options);
}
function assertGeometry(result,height,gap=6) {
  assert.equal(typeof result.compact,'boolean');
  for(const page of result.pages) {
    assert.ok(page.rows.length>0);
    assert.ok(usedHeight(page,gap)<=height+1e-7);
    for(const value of page.rows) assert.ok(Number.isFinite(value)&&value>=0);
    const occupied=new Set();
    for(const item of page.items) {
      assert.ok(Number.isInteger(item.row)&&item.row>=0&&item.row<page.rows.length);
      assert.ok(Number.isInteger(item.column)&&item.column>=0);
      assert.ok(Number.isInteger(item.span)&&item.span>0&&item.column+item.span<=12);
      assert.equal(item.height,page.rows[item.row]);
      for(let column=item.column;column<item.column+item.span;column++) {
        const cell=item.row+':'+column;
        assert.ok(!occupied.has(cell),'modules do not overlap');occupied.add(cell);
      }
    }
  }
}

test('default desktop modules fit one 600px page and give charts more surplus height',()=>{
  const result=plan(defaults,{width:1120,height:600});
  assert.equal(result.pages.length,1);assert.equal(result.compact,false);
  assert.deepEqual(ids(result),defaults.map(module=>module.id));
  assert.equal(result.pages[0].rows.length,5);assertGeometry(result,600);
  const items=Object.fromEntries(result.pages[0].items.map(item=>[item.id,item]));
  assert.ok(items.cashflow.height>=76);assert.ok(items.assets.height>=44);
  assert.ok(items.trend.height>=126);assert.ok(items.recent.height>=92);assert.ok(items.assistant.height>=72);
  assert.equal(items.trend.row,items.review.row);assert.equal(items.recent.row,items.automation.row);
  assert.ok(items.trend.height-126>items.cashflow.height-76);
});

test('390px narrow defaults retain every readable module on one 650px page',()=>{
  const result=plan(defaults,{width:390,height:650});
  assert.equal(result.pages.length,1);assert.equal(result.compact,true);
  assert.deepEqual(ids(result),defaults.map(module=>module.id));assertGeometry(result,650);
  const minima=[76,44,126,70,92,70,90];
  result.pages[0].items.forEach((item,index)=>{
    assert.equal(item.row,index);assert.equal(item.column,0);assert.equal(item.span,12);
    assert.ok(item.height>=minima[index]);
  });
});

test('all enabled modules paginate complete rows without loss or duplication',()=>{
  for(const width of [390,1120]) {
    const result=plan(allModules,{width,height:350});
    assert.ok(result.pages.length>1);assert.equal(result.compact,true);
    assert.deepEqual(ids(result),allModules.map(module=>module.id));assertGeometry(result,350);
    if(width>=600) {
      for(const pair of [['trend','review'],['recent','automation'],['allocation','projects']]) {
        const page=result.pages.find(page=>page.items.some(item=>item.id===pair[0]));
        const first=page.items.find(item=>item.id===pair[0]),second=page.items.find(item=>item.id===pair[1]);
        assert.ok(second,'a packed row stays on one page');assert.equal(first.row,second.row);
      }
    }
  }
});

test('mixed widths wrap strictly in input order with zero-based grid positions',()=>{
  const modules=[
    {id:'memo',width:'narrow'}, {id:'assets',width:'wide'},
    {id:'review',width:'half'}, {id:'automation',width:'narrow'},
    {id:'assistant',width:'narrow'}, {id:'trend',width:'wide'}, {id:'recent',width:'full'}
  ];
  const result=plan(modules,{width:600,height:900});
  assert.deepEqual(result.pages[0].items.map(({id,row,column,span})=>[id,row,column,span]),[
    ['memo',0,0,4],['assets',0,4,8],['review',1,0,6],['automation',1,6,4],
    ['assistant',2,0,4],['trend',2,4,8],['recent',3,0,12]
  ]);assertGeometry(result,900);
});

test('tiny and fractional viewports never overflow or produce negative geometry',()=>{
  for(const width of [0,390,599.9,600,1120])
    for(const height of [0,1,43,69,90,126,250,434,600,650.5])
      for(const gap of [0,6,6.5,1000]) {
        const result=plan(allModules,{width,height,gap});
        assert.deepEqual(ids(result),allModules.map(module=>module.id));assertGeometry(result,height,gap);
      }
});

test('malformed dimensions and empty inputs produce deterministic finite results',()=>{
  assert.deepEqual(plan([],{}).pages,[]);assert.deepEqual(plan(null,null).pages,[]);
  for(const value of [undefined,null,NaN,Infinity,-Infinity,-20,'650',{}]) {
    const result=plan(defaults,{width:value,height:value,gap:value});
    assert.deepEqual(ids(result),defaults.map(module=>module.id));assertGeometry(result,0,6);
    assert.deepEqual(result,plan(defaults,{width:value,height:value,gap:value}));
  }
  const huge=plan(defaults,{width:Number.MAX_VALUE,height:Number.MAX_VALUE});
  assertGeometry(huge,Number.MAX_VALUE);
});

test('positive minHeight overrides reserve status space and remain bounded',()=>{
  const modules=defaults.map(module=>({...module,...(module.id==='assistant'?{minHeight:108}:{})}));
  const result=plan(modules,{width:390,height:650});
  assert.equal(result.pages.length,1);assertGeometry(result,650);
  assert.ok(result.pages[0].items.find(item=>item.id==='assistant').height>=108);
  const clamped=plan([{id:'memo',width:'full',minHeight:999},{id:'assets',width:'full'}],{width:800,height:600});
  assertGeometry(clamped,600);assert.equal(clamped.pages.length,1);
  assert.ok(clamped.pages[0].rows[0]>=500);assert.ok(clamped.pages[0].rows[1]>=44);
  for(const minHeight of [0,-1,NaN,Infinity,'90']) {
    const result=plan([{id:'assistant',width:'full',minHeight}],{width:800,height:72});
    assert.equal(result.pages[0].rows[0],72);
  }
});

test('planning preserves frozen inputs and supports unknown modules at full width',()=>{
  const modules=Object.freeze(defaults.map(module=>Object.freeze({...module})));
  const before=JSON.stringify(modules),options=Object.freeze({width:1120,height:600,gap:6});
  const first=plan(modules,options);assert.equal(JSON.stringify(modules),before);
  assert.deepEqual(plan(modules,options),first);
  const future=plan([null,{}, {id:'future',width:'invalid'}],{width:800,height:70});
  assert.deepEqual(ids(future),['future']);assert.equal(future.pages[0].items[0].span,12);assertGeometry(future,70);
});
