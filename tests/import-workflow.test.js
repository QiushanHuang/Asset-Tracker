const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const M = fs.existsSync(
  require("node:path").join(__dirname, "../ledger-import.js"),
)
  ? require("../ledger-import.js")
  : {};
const base = () => ({
  categories: {
    cash: { id: "cash", name: "现金", balance: 100, currency: "CNY" },
  },
  transactions: [],
  expenseProjects: [],
  settings: { baseCurrency: "CNY", exchangeRates: { CNY: 1 } },
  automationRules: [],
  purposeCategories: [],
  initialAssets: [],
  memo: "",
  transactionTemplates: [],
});
const row = (extra = {}) => ({
  日期: "2026-09-19",
  类别: "现金",
  金额: -10,
  货币类型: "CNY",
  描述: "午餐",
  ...extra,
});
test("preflight validates all rows and never mutates the source ledger", () => {
  const b = base(),
    before = JSON.stringify(b);
  const p = M.prepare(b, [
    row(),
    row({ 金额: "12oops" }),
    row({ 日期: "2026-02-30" }),
    row({ 类别: "不存在" }),
  ]);
  assert.equal(p.errors.length, 3);
  assert.equal(JSON.stringify(b), before);
});
test("export/import preserves stable IDs and project attribution; repeated import is skipped", () => {
  const b = base();
  b.expenseProjects = [
    {
      id: "trip",
      name: "旅行",
      archived: false,
      categories: [{ id: "food", name: "餐饮", parentId: null }],
    },
  ];
  b.transactions = [
    {
      id: "one",
      date: "2026-09-19",
      category: "现金",
      accountId: "cash",
      amount: -10,
      currency: "CNY",
      type: "单次",
      purpose: "其他",
      description: "午餐",
      projectId: "trip",
      expenseCategoryId: "food",
    },
  ];
  const rows = M.rows(b);
  const p = M.prepare(b, rows);
  assert.equal(p.duplicates.length, 1);
  assert.equal(p.errors.length, 0);
  const empty = { ...b, transactions: [] };
  const c = M.prepare(empty, rows);
  assert.equal(c.accepted[0].transaction.projectId, "trip");
  assert.equal(c.accepted[0].transaction.expenseCategoryId, "food");
  assert.equal(c.accepted[0].transaction.accountId, "cash");
});
test("same ID with changed content is a conflict, not a silently skipped duplicate", () => {
  const b = base();
  b.transactions = [
    {
      id: "one",
      date: "2026-09-19",
      category: "现金",
      accountId: "cash",
      amount: -10,
      currency: "CNY",
      type: "单次",
      purpose: "其他",
      description: "午餐",
    },
  ];
  const r = M.rows(b);
  r[0]["金额"] = -20;
  assert.match(M.prepare(b, r).errors[0].message, /冲突/);
});
test("suspected duplicates can be retained explicitly and exact ID duplicates cannot", () => {
  const b = base(),
    p = M.prepare(b, [row(), row()]);
  assert.equal(p.suspected.length, 1);
  assert.equal(M.apply(b, p, false).transactions.length, 1);
  assert.equal(M.apply(b, p, true).transactions.length, 2);
});
test("candidate is atomic, adjusts the correct account and rejects stale previews", () => {
  const b = base(),
    p = M.prepare(b, [row()]);
  const c = M.apply(b, p);
  assert.equal(c.categories.cash.balance, 90);
  assert.equal(b.categories.cash.balance, 100);
  b.memo = "concurrent change";
  assert.throws(() => M.apply(b, p), /变化/);
});
test("ambiguous account names and unconvertible currencies are rejected", () => {
  const b = base();
  b.categories.other = {
    id: "other",
    name: "现金",
    balance: 0,
    currency: "CNY",
  };
  assert.match(M.prepare(b, [row()]).errors[0].message, /唯一/);
  delete b.categories.other;
  assert.match(
    M.prepare(b, [row({ 货币类型: "XYZ" })]).errors[0].message,
    /汇率/,
  );
});
test("spreadsheet serial dates, zero and foreign currency conversion are deliberate", () => {
  const b = base();
  b.settings.exchangeRates.USD = 7;
  const p = M.prepare(b, [
    row({ 日期: 46284, 金额: 0 }),
    row({ 金额: -2, 货币类型: "USD" }),
  ]);
  assert.equal(p.errors.length, 0);
  assert.equal(M.apply(b, p).categories.cash.balance, 86);
});

test('real XLSX roundtrip retains stable IDs, project fields, Unicode and literal formula text',()=>{
 const XLSX=require('../vendor/xlsx.full.min.js');const b=base();b.expenseProjects=[{id:'p',name:'演示旅行',archived:false,categories:[{id:'c',name:'餐饮',parentId:null}]}];
 b.transactions=[{id:'demo-xlsx',date:'2026-09-19T12:30',category:'现金',accountId:'cash',amount:-12.5,currency:'CNY',type:'单次',purpose:'其他',description:'=HYPERLINK("https://example.invalid","演示")',projectId:'p',expenseCategoryId:'c'}];
 const sheet=XLSX.utils.json_to_sheet(M.rows(b));assert.ok(Object.values(sheet).filter(v=>v&&typeof v==='object').every(cell=>!cell.f));
 const wb=XLSX.utils.book_new();XLSX.utils.book_append_sheet(wb,sheet,'交易记录');const bytes=XLSX.write(wb,{type:'buffer',bookType:'xlsx'});const read=XLSX.read(bytes,{type:'buffer'});
 const plan=M.prepare({...b,transactions:[]},XLSX.utils.sheet_to_json(read.Sheets['交易记录'],{defval:''}));assert.equal(plan.errors.length,0);const t=plan.accepted[0].transaction;assert.equal(t.id,'demo-xlsx');assert.equal(t.projectId,'p');assert.equal(t.expenseCategoryId,'c');assert.equal(t.description,b.transactions[0].description);assert.equal(t.date,b.transactions[0].date);
});
test('spreadsheet expenses increase debt and preserve foreign-currency conversion',()=>{
 const b=base();b.categories.cash.isDebt=true;b.settings.exchangeRates.USD=7;
 assert.equal(M.apply(b,M.prepare(b,[row({'金额':-20})])).categories.cash.balance,120);
 assert.equal(M.apply(b,M.prepare(b,[row({'金额':-2,'货币类型':'USD'})])).categories.cash.balance,114);
});
test('spreadsheet transfers are explicitly marked and rejected rather than losing pairing',()=>{
 const b=base();b.transactions=[{id:'transfer-out',date:'2026-09-19',accountId:'cash',category:'现金',amount:-20,currency:'CNY',transferId:'pair',purpose:'内部转账'}];const rows=M.rows(b);assert.equal(rows[0]['内部转账ID'],'pair');
 const plan=M.prepare({...b,transactions:[]},rows);assert.equal(plan.accepted.length,0);assert.match(plan.errors[0].message,/JSON/);
 assert.throws(()=>M.apply({...b,transactions:[]},plan),/错误/);
});
test('legacy debt balance deltas are exported with an explicit non-roundtrip marker',()=>{
 const b=base();b.categories.cash.isDebt=true;b.transactions=[{id:'legacy-debt',category:'现金',date:'2026-09-19',amount:20,currency:'CNY'}];
 const rows=M.rows(b);assert.equal(rows[0]['金额语义'],'历史余额变动');assert.match(M.prepare({...b,transactions:[]},rows).errors[0].message,/JSON/);
});
