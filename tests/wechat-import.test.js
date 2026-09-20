const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const W = fs.existsSync(
  require("node:path").join(__dirname, "../wechat-import.js"),
)
  ? require("../wechat-import.js")
  : {};
const heads = [
  "交易时间",
  "交易类型",
  "交易对方",
  "商品",
  "收/支",
  "金额(元)",
  "支付方式",
  "当前状态",
  "交易单号",
  "商户单号",
  "备注",
];
const row = (id = "420000000000000000000000000001", extra = {}) => {
  const r = {
    交易时间: "2026-09-19 12:03:04",
    交易类型: "商户消费",
    交易对方: "测试商户",
    商品: "午餐",
    "收/支": "支出",
    "金额(元)": 12.3,
    支付方式: "零钱",
    当前状态: "支付成功",
    交易单号: id,
    商户单号: "merchant-1",
    备注: "/",
  };
  return heads.map((h) => ({ ...r, ...extra })[h]);
};
const grid = (rows) => [
  ["微信支付账单明细"],
  ...Array.from({ length: 16 }, () => []),
  heads,
  ...rows,
];
const book = () => ({
  categories: {
    wallet: {
      id: "wallet",
      name: "微信零钱",
      currency: "CNY",
      balance: 100,
      isDebt: false,
    },
    card: {
      id: "card",
      name: "信用卡",
      currency: "CNY",
      balance: 20,
      isDebt: true,
    },
  },
  transactions: [],
  expenseProjects: [],
  automationRules: [],
  purposeCategories: [],
  initialAssets: [],
  transactionTemplates: [],
  memo: "",
  settings: { baseCurrency: "CNY", exchangeRates: { CNY: 1 } },
});
test("finds the real header after the preamble and preserves long text IDs, seconds and original fields", () => {
  const p = W.parse(grid([row()]));
  assert.equal(p.headerRow, 18);
  assert.equal(p.records.length, 1);
  assert.equal(p.records[0].date, "2026-09-19T12:03:04");
  assert.equal(p.records[0].amount, -12.3);
  assert.equal(
    p.records[0].source.transactionId,
    "420000000000000000000000000001",
  );
  assert.equal(p.records[0].source.counterparty, "测试商户");
});
test("refund is a separate income; refunded original expense keeps its full amount", () => {
  const p = W.parse(
    grid([
      row("order-001", { 当前状态: "已全额退款" }),
      row("refund-001", {
        交易类型: "测试商户-退款",
        "收/支": "收入",
        当前状态: "已全额退款",
      }),
    ]),
  );
  assert.deepEqual(
    p.records.map((r) => r.amount),
    [-12.3, 12.3],
  );
  assert.equal(p.totals.incomeCents, 1230);
  assert.equal(p.totals.expenseCents, 1230);
});
test("neutral and unposted rows are explained and unknown statuses require review", () => {
  const p = W.parse(
    grid([
      row("neutral-001", { "收/支": "/", 交易类型: "零钱提现" }),
      row("closed-001", { 当前状态: "交易关闭" }),
      row("unknown-001", { 当前状态: "新状态" }),
    ]),
  );
  assert.equal(p.skipped.length, 2);
  assert.equal(p.records[0].needsReview, true);
  const plan = W.prepare(book(), p, { 零钱: "wallet" });
  assert.equal(plan.review.length, 1);
  assert.equal(W.apply(book(), plan).transactions.length, 0);
  assert.equal(
    W.apply(book(), plan, { includeReview: true }).transactions.length,
    1,
  );
});
test("requires a CNY leaf-account mapping and rejects malformed amounts, dates and numeric identifiers", () => {
  const b = book();
  const p = W.parse(grid([row()]));
  assert.equal(W.prepare(b, p, {}).errors.length, 1);
  b.categories.wallet.currency = "USD";
  assert.equal(W.prepare(b, p, { 零钱: "wallet" }).errors.length, 1);
  for (const extra of [
    { "金额(元)": "12oops" },
    { "金额(元)": "-12" },
    { "金额(元)": "0.001" },
    { 交易时间: "2026-02-30 12:00:00" },
    { 交易单号: 420000000000000000000000000001 },
  ])
    assert.equal(W.parse(grid([row(undefined, extra)])).errors.length, 1);
});
test("history import preserves balances by default, repeated and overlapping files do not duplicate", () => {
  const b = book(),
    p = W.parse(grid([row()])),
    plan = W.prepare(b, p, { 零钱: "wallet" });
  const after = W.apply(b, plan);
  assert.equal(after.categories.wallet.balance, 100);
  assert.equal(after.transactions.length, 1);
  assert.equal(b.transactions.length, 0);
  const again = W.prepare(after, p, {});
  assert.equal(again.duplicates.length, 1);
  assert.equal(again.errors.length, 0);
  assert.equal(W.apply(after, again).transactions.length, 1);
  const changed = JSON.parse(JSON.stringify(after));
  changed.transactions[0].description = "用户编辑";
  assert.equal(W.prepare(changed, p, {}).duplicates.length, 1);
});
test("adjusting balances applies asset/debt direction correctly and stale previews cannot replace edits", () => {
  const b = book(),
    p = W.parse(grid([row()]));
  const wallet = W.apply(b, W.prepare(b, p, { 零钱: "wallet" }), {
    adjustBalances: true,
  });
  assert.equal(wallet.categories.wallet.balance, 87.7);
  const card = W.apply(b, W.prepare(b, p, { 零钱: "card" }), {
    adjustBalances: true,
  });
  assert.equal(card.categories.card.balance, 32.3);
  const plan = W.prepare(b, p, { 零钱: "wallet" });
  b.memo = "new edit";
  assert.throws(() => W.apply(b, plan), /变化/);
});
test("changed financial facts for an existing source ID are blocked while status changes are reported", () => {
  const p = W.parse(grid([row()])),
    b = W.apply(book(), W.prepare(book(), p, { 零钱: "wallet" }));
  assert.equal(
    W.prepare(b, W.parse(grid([row(undefined, { "金额(元)": 13 })])), {}).errors
      .length,
    1,
  );
  const updated = W.prepare(
    b,
    W.parse(grid([row(undefined, { 当前状态: "已全额退款" })])),
    {},
  );
  assert.equal(updated.duplicates.length, 1);
  assert.equal(updated.warnings.length, 1);
});
test("possible manual entries require review but distinct WeChat IDs with identical content remain distinct", () => {
  const b = book();
  b.transactions = [
    {
      id: "manual",
      date: "2026-09-19",
      accountId: "wallet",
      category: "微信零钱",
      currency: "CNY",
      amount: -12.3,
      description: "手工",
    },
  ];
  const p = W.parse(grid([row(), row("420000000000000000000000000002")]));
  assert.equal(W.prepare(b, p, { 零钱: "wallet" }).review.length, 2);
  assert.equal(W.prepare(book(), p, { 零钱: "wallet" }).accepted.length, 2);
});
test("source count mismatch, duplicate headers and duplicate conflicting IDs are rejected", () => {
  const g = grid([row()]);
  g[6] = ["共2笔记录"];
  assert.throws(() => W.parse(g), /数量/);
  assert.throws(() => W.parse([heads, heads, row()]), /表头/);
  const p = W.parse(grid([row(), row(undefined, { "金额(元)": 22 })]));
  assert.equal(W.prepare(book(), p, { 零钱: "wallet" }).errors.length, 1);
});
test("history provenance survives editing and deletion without changing current balances", () => {
  const N = require("../nas-model.js"),
    p = W.parse(grid([row()])),
    b = W.apply(book(), W.prepare(book(), p, { 零钱: "wallet" }));
  const edited = N.edit(b, b.transactions[0].id, {
    accountId: "wallet",
    direction: "expense",
    amount: "15",
    date: "2026-09-19",
  });
  assert.equal(edited.categories.wallet.balance, 100);
  assert.equal(
    edited.transactions[0].wechat.transactionId,
    b.transactions[0].wechat.transactionId,
  );
  assert.equal(
    N.remove(b, b.transactions[0].id).categories.wallet.balance,
    100,
  );
});
test("wechat credit-card postings and subsequent edits/removal retain the debt sign convention", () => {
  const N = require("../nas-model.js"),
    p = W.parse(grid([row()])),
    b = W.apply(book(), W.prepare(book(), p, { 零钱: "card" }), {
      adjustBalances: true,
    });
  const edited = N.edit(b, b.transactions[0].id, {
    accountId: "card",
    direction: "expense",
    amount: "15",
    date: "2026-09-19",
  });
  assert.equal(edited.categories.card.balance, 35);
  assert.equal(N.remove(b, b.transactions[0].id).categories.card.balance, 20);
});
test("import provenance roundtrips through the book validator and invalid provenance is rejected", () => {
  const S = require("../legacy-safety.js"),
    p = W.parse(grid([row()])),
    b = W.apply(book(), W.prepare(book(), p, { 零钱: "wallet" }));
  assert.equal(S.validateBookText(JSON.stringify(b)).status, "valid");
  for (const override of [
    { version: 2 },
    { transactionId: 123 },
    { balanceMode: "guess" },
    { signature: "not json" },
  ]) {
    const bad = JSON.parse(JSON.stringify(b));
    Object.assign(bad.transactions[0].wechat, override);
    assert.equal(S.validateBookText(JSON.stringify(bad)).status, "corrupt");
  }
});
test("1904 workbook dates are translated without shifting text timestamps", () => {
  const serial =
    (Date.UTC(2026, 8, 19, 12, 3, 4) - Date.UTC(1899, 11, 30)) / 86400000;
  const g = grid([row(undefined, { 交易时间: serial - 1462 })]);
  const workbook = {
    SheetNames: ["Sheet1"],
    Sheets: { Sheet1: {} },
    Workbook: { WBProps: { date1904: true } },
  };
  const parsed = W.readWorkbook(workbook, {
    utils: { sheet_to_json: () => g },
  });
  assert.equal(parsed.records[0].date, "2026-09-19T12:03:04");
});
