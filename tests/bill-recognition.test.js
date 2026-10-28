const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const modulePath = path.join(__dirname, '../bill-recognition.js');
const R = fs.existsSync(modulePath) ? require(modulePath) : {recognize: () => ({items:[],warnings:[]})};
const context = {today:'2026-10-02',accounts:[{id:'cash',name:'现金',names:['现金'],currency:'CNY'},{id:'wx',name:'微信 / 零钱',names:['微信','零钱'],currency:'CNY'}],purposes:['餐饮','交通']};
const one = text => R.recognize(text,context).items[0];

test('offline text resolves yesterday using the supplied date and exact account evidence', () => {
  const item=one('昨天午餐支出32.50元，用现金，餐饮');
  assert.ok(item,'recognizer should create a reviewable draft');
  assert.equal(item.proposal.date,'2026-10-01');assert.equal(item.proposal.amount,'32.50');
  assert.equal(item.proposal.accountId,'cash');assert.equal(item.proposal.direction,'expense');assert.equal(item.proposal.purpose,'餐饮');
});
test('explicit date and time survive parsing and invalid dates are not rolled forward', () => {
  assert.equal(one('2026/09/30 12:03:04 现金 支出 ¥18.00 午餐').proposal.date,'2026-09-30T12:03:04');
  const bad=one('2026-02-30 现金 午餐32元');assert.equal(bad.proposal.date,'');assert.ok(bad.warnings.some(x=>/日期/.test(x)));
});
test('missing and ambiguous accounts remain blank and an explicit default may be used', () => {
  assert.equal(one('今天午餐32元').proposal.accountId,'');
  assert.equal(one('今天现金和微信零钱支出32元').proposal.accountId,'');
  assert.equal(R.recognize('今天午餐32元',{...context,defaultAccountId:'cash'}).items[0].proposal.accountId,'cash');
});
test('receipt labels distinguish actual paid from balance, discount, original price and transaction ID', () => {
  const text='微信支付\n商户：小食堂\n交易时间：2026年10月2日 12:30:08\n实付金额：¥28.50\n订单金额：35.00元\n优惠：6.50元\n余额：500.00元\n支付方式：零钱\n交易单号：00000123456789\n支付成功';
  const item=one(text);assert.equal(item.proposal.amount,'28.50');assert.equal(item.proposal.date,'2026-10-02T12:30:08');
  assert.equal(item.proposal.description,'小食堂');assert.equal(item.proposal.accountId,'wx');
  assert.deepEqual(item.sourceIdentity,{provider:'wechat',id:'00000123456789'});assert.equal(item.sourceText,text);
});
test('conflicting paid amounts are left for review and balances alone are not transactions', () => {
  const conflict=one('今天现金 午餐32元，车费18元');assert.equal(conflict.proposal.amount,'');assert.ok(conflict.warnings.some(x=>/金额/.test(x)));
  assert.equal(one('今天现金 余额500元 订单号123456789').proposal.amount,'');
});
test('transfers and unconfirmed refunds stay incomplete while a received refund is income', () => {
  for(const text of ['今天现金转账100元到微信零钱','今天申请退款32元 现金']) {
    const item=one(text);assert.equal(item.proposal.amount,'');assert.ok(item.warnings.length);
  }
  const refund=one('今天现金退款到账32元');assert.equal(refund.proposal.amount,'32');assert.equal(refund.proposal.direction,'income');
});
test('CSV recognizes WeChat preamble, quoted commas, leading-zero identities and unsuccessful rows', () => {
  const input='微信支付账单明细\n导出时间：2026-10-02\n交易时间,交易类型,交易对方,商品,收/支,金额(元),支付方式,当前状态,交易单号,商户单号\n2026-10-01 12:30:00,商户消费,"食堂,一楼",午餐,支出,￥32.00,零钱,支付成功,0000123,0000456\n2026-10-01 13:00:00,商户消费,便利店,饮料,支出,5.00,零钱,支付失败,0000999,\n';
  const result=R.recognize(input,context);assert.equal(result.items.length,1);assert.match(result.format,/wechat/);
  const item=result.items[0];assert.equal(item.proposal.amount,'32.00');assert.equal(item.proposal.accountId,'wx');assert.match(item.proposal.description,/食堂,一楼/);
  assert.deepEqual(item.sourceIdentity,{provider:'wechat',id:'0000123'});assert.ok(result.warnings.some(x=>/跳过/.test(x)));
});
test('Alipay TSV recognizes column aliases and incoming amounts without leaking fee fields', () => {
  const input='支付宝交易记录\n交易号\t商家订单号\t交易创建时间\t交易对方\t商品名称\t金额（元）\t收/支\t交易状态\t服务费（元）\n0000333\t0000009\t2026-10-01 09:01:02\t张三\t报销款\t1,200.50\t收入\t交易成功\t0.20';
  const result=R.recognize(input,context),item=result.items[0];assert.equal(result.items.length,1);assert.match(result.format,/alipay/);
  assert.equal(item.proposal.amount,'1200.50');assert.equal(item.proposal.direction,'income');assert.equal(item.proposal.accountId,'');
  assert.deepEqual(item.sourceIdentity,{provider:'alipay',id:'0000333'});
});
test('unrecognized tables and incomplete rows never fabricate transaction facts', () => {
  const result=R.recognize('姓名,年龄\n张三,32',context);assert.equal(result.items[0].proposal.amount,'');
  const partial=one('现金午餐');assert.equal(partial.proposal.amount,'');assert.equal(partial.proposal.date,'');assert.ok(partial.warnings.length>=2);
});
test('table direction and currency remain distinct: refunds and neutral transfers need review', () => {
  const input='微信支付账单明细\n交易时间,交易对方,收/支,金额(元),支付方式,当前状态,交易单号\n2026-10-01 12:00:00,张三,不计收支,100,零钱,转账成功,0001\n2026-10-01 13:00:00,食堂,支出,32,零钱,已退款,0002';
  const result=R.recognize(input,context);assert.equal(result.items.length,2);assert.ok(result.items.every(x=>x.proposal.amount===''));
});
test('numeric IDs are never coerced and repeated source rows remain separate reviewable items', () => {
  const input='微信支付账单明细\n交易时间,交易对方,收/支,金额(元),交易单号\n2026-10-01,食堂,支出,32,00000000000000000000001\n2026-10-01,食堂,支出,32,00000000000000000000001';
  const result=R.recognize(input,context);assert.equal(result.items.length,2);assert.equal(result.items[0].sourceIdentity.id,'00000000000000000000001');
});
test('parsing is bounded, rejects malformed quoting, and never mutates the supplied context', () => {
  const before=JSON.stringify(context);R.recognize('今天现金午餐32元',context);assert.equal(JSON.stringify(context),before);
  assert.throws(()=>R.recognize('x'.repeat(1024*1024+1),context),/长度|过大|超过/);
  assert.throws(()=>R.recognize('交易时间,金额(元),收/支\n"2026-10-01,32,支出',context),/引号|格式/);
  assert.throws(()=>R.recognize('交易时间,金额(元),收/支\n'+'2026-10-01,32,支出\n'.repeat(1001),context),/行|笔/);
});
test('malformed numeric tokens cannot be recognized as a smaller trailing amount', () => {
  for(const value of ['1e3','12.3.4','1,23'])assert.equal(one(`今天现金午餐${value}元`).proposal.amount,'');
  assert.equal(one('今天现金 余额：CNY 500.00').proposal.amount,'');
});
test('signed income conflicts and table column shifts stay incomplete', () => {
  assert.equal(one('今天现金收入-100元').proposal.amount,'');
  const result=R.recognize('交易时间,交易对方,收/支,金额(元),支付方式\n2026-10-02,食堂,支出,1,200.00,现金',context);
  assert.equal(result.items[0].proposal.amount,'');
});
test('receipt labels copied on separate lines preserve the actual amount and date', () => {
  const item=one('微信支付\n商户\n小食堂\n交易时间\n2026-10-02 12:30:08\n实付金额\n28.50元\n优惠\n6.50元\n支付方式\n零钱');
  assert.equal(item.proposal.amount,'28.50');assert.equal(item.proposal.description,'小食堂');assert.equal(item.proposal.accountId,'wx');
});
test('English receipt labels from offline OCR recognize total without mistaking tax or subtotal', () => {
  const item=one('LOCAL RECEIPT\nDATE: 2026-10-02\nTOTAL: USD 32.50\nSUBTOTAL: 30.00\nTAX: 2.50');
  assert.equal(item.proposal.amount,'32.50');assert.equal(item.proposal.currency,'USD');assert.equal(item.proposal.date,'2026-10-02');
  const plain=one('LOCAL RECEIPT\nDATE: 2026-10-02\nTOTAL: 32.50\nSUBTOTAL: 30.00\nTAX: 2.50');
  assert.equal(plain.proposal.amount,'32.50');assert.equal(plain.proposal.currency,'');
});
test('a clearly failed receipt is skipped with an explanation', () => {
  const result=R.recognize('支付失败\n交易时间：2026-10-02\n实付金额：32元\n支付方式：现金',context);
  assert.equal(result.items.length,0);assert.ok(result.warnings.some(x=>/跳过/.test(x)));
});

test('unknown statement identities and ambiguous dollar currency remain unconfirmed',()=>{
 const result=R.recognize('日期,金额,收支,账户,交易号\n2026-10-02,32,支出,现金,0000123',{today:'2026-10-02',accounts:[{id:'cash',name:'现金',currency:'CNY'}]});
 assert.equal(result.items[0].sourceIdentity,undefined);assert.match(result.items[0].warnings.join('；'),/来源/);
 const dollars=R.recognize('2026-10-02 cash 支出 $32',{today:'2026-10-02',accounts:[{id:'cash',name:'cash',currency:'CNY'}]});assert.equal(dollars.items[0].proposal.currency,'');
});
