const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs"),
  path = require("node:path");
const M = fs.existsSync(path.join(__dirname, "../../nas-model.js"))
  ? require("../../nas-model.js")
  : {};
const { emptyBook, validateBook } = require("../../server/server.cjs");
test("shared entry uses account currency and changes only a copy", () => {
  const b = emptyBook();
  const n = M.entry(b, {
    accountId: "cash",
    direction: "expense",
    amount: "12.50",
    date: "2026-09-19",
    description: "午餐",
  });
  assert.equal(b.transactions.length, 0);
  assert.equal(n.categories.cash.balance, -12.5);
  assert.equal(n.transactions[0].currency, "CNY");
  validateBook(n);
});
test("same-currency transfers preserve household totals and balances", () => {
  const b = emptyBook();
  b.categories.cash.balance = 100;
  const c = M.account(b, { name: "银行卡", currency: "CNY" });
  const bank = Object.keys(c.categories).find((x) => x !== "cash");
  const n = M.transfer(c, {
    from: "cash",
    to: bank,
    amount: "20",
    date: "2026-09-19",
  });
  assert.equal(n.categories.cash.balance, 80);
  assert.equal(n.categories[bank].balance, 20);
  validateBook(n);
});
test("invalid, negative, excess precision, and cross-currency transfers are refused", () => {
  const b = emptyBook();
  for (const amount of ["", "0", "-1", "1abc", "1.001", "Infinity"])
    assert.throws(() =>
      M.entry(b, { amount, accountId: "cash", date: "2026-09-19" }),
    );
  const c = M.account(b, { name: "USD", currency: "USD" });
  const usd = Object.keys(c.categories).find((x) => x !== "cash");
  assert.throws(
    () =>
      M.transfer(c, {
        from: "cash",
        to: usd,
        amount: "20",
        date: "2026-09-19",
      }),
    /同币种/,
  );
});
test("household totals use only explicit shared selections and never convert currencies implicitly", () => {
  const l = [
    {
      id: "a",
      kind: "personal",
      summary: { CNY: { income: 100, expense: 3, count: 1 } },
    },
    {
      id: "b",
      kind: "family",
      summary: { CNY: { income: 20, expense: 5, count: 2 } },
    },
    {
      id: "c",
      kind: "shared",
      summary: { USD: { income: 10, expense: 2, count: 3 } },
    },
  ];
  assert.deepEqual(M.household(l, ["a", "b", "c"]), {
    CNY: { income: 20, expense: 5, count: 2 },
    USD: { income: 10, expense: 2, count: 3 },
  });
  assert.deepEqual(M.household(l, []), {});
});
test("edit and delete reverse prior account effects; a transfer deletes as a pair", () => {
  let b = M.entry(emptyBook(), {
    accountId: "cash",
    direction: "expense",
    amount: "12.50",
    date: "2026-09-19",
  });
  const id = b.transactions[0].id;
  const edited = M.edit(b, id, {
    accountId: "cash",
    direction: "expense",
    amount: "20",
    date: "2026-09-19",
  });
  assert.equal(edited.transactions[0].id, id);
  assert.equal(edited.categories.cash.balance, -20);
  assert.equal(M.remove(edited, id).categories.cash.balance, 0);
  let c = M.account(emptyBook(), { name: "bank", currency: "CNY" });
  const bank = Object.keys(c.categories).find((x) => x !== "cash");
  c = M.transfer(c, {
    from: "cash",
    to: bank,
    amount: "5",
    date: "2026-09-19",
  });
  c = M.remove(c, c.transactions[0].id);
  assert.equal(c.transactions.length, 0);
  assert.equal(c.categories.cash.balance, 0);
  assert.equal(c.categories[bank].balance, 0);
});
test("editing preserves time and lineage; inverse edits retain fractional imported account precision", () => {
  let b = emptyBook();
  b.categories.cash.balance = 100.002;
  b = M.entry(b, {
    accountId: "cash",
    direction: "expense",
    amount: "12.50",
    date: "2026-09-19T12:35",
    description: "original",
  });
  const t = b.transactions[0];
  t.includeTime = true;
  t.ruleId = "legacy-rule";
  const edited = M.edit(b, t.id, {
    accountId: "cash",
    direction: "expense",
    amount: "13",
    date: "2026-09-20",
  });
  assert.equal(edited.transactions[0].date, "2026-09-20T12:35");
  assert.equal(edited.transactions[0].ruleId, "legacy-rule");
  assert.equal(M.remove(edited, t.id).categories.cash.balance, 100.002);
});
test('debt expense increases liability; edit and removal reverse the correct recorded convention',()=>{
 const b=emptyBook();b.categories.cash.isDebt=true;b.categories.cash.balance=100;
 const expense=M.entry(b,{accountId:'cash',direction:'expense',amount:'20',date:'2026-09-20'});assert.equal(expense.categories.cash.balance,120);assert.equal(expense.transactions[0].amount,-20);
 const edited=M.edit(expense,expense.transactions[0].id,{accountId:'cash',direction:'expense',amount:'30',date:'2026-09-20'});assert.equal(edited.categories.cash.balance,130);assert.equal(M.remove(edited,edited.transactions[0].id).categories.cash.balance,100);
 const credit=M.entry(b,{accountId:'cash',direction:'income',amount:'20',date:'2026-09-20'});assert.equal(credit.categories.cash.balance,80);
 b.transactions=[{id:'legacy-debt',category:'现金',date:'2026-09-20',amount:20}];assert.equal(M.remove(b,'legacy-debt').categories.cash.balance,80);
});
test('legacy debt edits cannot silently convert balance-delta semantics into signed cash flow',()=>{
 const b=emptyBook();b.categories.cash.isDebt=true;b.categories.cash.balance=100;b.transactions=[{id:'legacy',date:'2026-09-20',category:'现金',amount:20,currency:'CNY'}];
 assert.throws(()=>M.edit(b,'legacy',{accountId:'cash',direction:'income',amount:'20',date:'2026-09-20'}),/历史负债/);assert.equal(b.categories.cash.balance,100);
});
