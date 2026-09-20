const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const A = fs.existsSync(
  require("node:path").join(__dirname, "../alipay-import.js"),
)
  ? require("../alipay-import.js")
  : {};
const headers = [
  "交易时间",
  "交易分类",
  "交易对方",
  "对方账号",
  "商品说明",
  "收/支",
  "金额",
  "收/付款方式",
  "交易状态",
  "交易订单号",
  "商家订单号",
  "备注",
  "",
];
const r = (id = "202600000000000000000000000001", extra = {}) => {
  const data = {
    交易时间: "2026-09-19 14:15:16",
    交易分类: "餐饮美食",
    交易对方: "测试商户",
    对方账号: "test***",
    商品说明: "午餐",
    "收/支": "支出",
    金额: "18.50",
    "收/付款方式": "账户余额",
    交易状态: "交易成功",
    交易订单号: id,
    商家订单号: "shop-001",
    备注: "/",
  };
  return headers.map((h) => ({ ...data, ...extra })[h] || "");
};
const grid = (rows) => [
  ["支付宝交易明细"],
  ...Array.from({ length: 22 }, () => []),
  headers,
  ...rows,
];
const book = () => ({
  categories: {
    cash: { id: "cash", name: "支付宝余额", currency: "CNY", balance: 100 },
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
test("Alipay finds row 24, preserves textual order IDs and uses its own namespace and provenance", () => {
  const p = A.parse(grid([r()]));
  assert.equal(p.headerRow, 24);
  assert.equal(p.provider, "alipay");
  assert.equal(p.records[0].id, "alipay:202600000000000000000000000001");
  assert.equal(p.records[0].amount, -18.5);
  const b = A.apply(book(), A.prepare(book(), p, { 账户余额: "cash" }));
  assert.equal(b.transactions[0].alipay.counterpartyAccount, "test***");
  assert.equal(b.transactions[0].wechat, undefined);
  assert.equal(b.categories.cash.balance, 100);
  assert.equal(A.prepare(b, p, {}).duplicates.length, 1);
});
test("small-pocket deposits, neutral transfers, repayment and closed orders never become consumption", () => {
  const p = A.parse(
    grid([
      r("fund-001", { 交易分类: "账户存取", 商品说明: "支付宝小荷包-自动攒" }),
      r("fund-002", {
        交易分类: "投资理财",
        商品说明: "余额宝-自动转入",
        "收/支": "不计收支",
      }),
      r("repay-001", {
        交易分类: "信用借还",
        "收/支": "不计收支",
        交易状态: "还款成功",
      }),
      r("closed-001", { 交易状态: "交易关闭" }),
    ]),
  );
  assert.equal(p.total, 4);
  assert.equal(p.records.length, 0);
  assert.equal(p.skipped.length, 4);
  assert.ok(p.skipped[0].reason.includes("资金划转"));
});
test("neutral refunds and investment yield require explicit per-row review; coupon combinations remain review-only", () => {
  const p = A.parse(
    grid([
      r("refund-001", {
        交易分类: "退款",
        交易状态: "退款成功",
        "收/支": "不计收支",
      }),
      r("yield-001", {
        交易分类: "投资理财",
        商品说明: "余额宝-2026.09.19-收益发放",
        "收/支": "不计收支",
      }),
      r("coupon-001", { "收/付款方式": "花呗&优惠" }),
    ]),
  );
  assert.equal(p.records.length, 3);
  assert.deepEqual(
    p.records.map((r) => r.amount),
    [18.5, 18.5, -18.5],
  );
  const plan = A.prepare(book(), p, { 账户余额: "cash", "花呗&优惠": "cash" });
  assert.equal(plan.review.length, 3);
  assert.equal(A.apply(book(), plan).transactions.length, 0);
  const selected = A.apply(book(), plan, { reviewIds: ["alipay:yield-001"] });
  assert.equal(selected.transactions.length, 1);
  assert.equal(selected.transactions[0].alipay.originalDirection, "不计收支");
});
test("same transaction id on different payment platforms does not collide", () => {
  const p = A.parse(grid([r()])),
    b = book();
  b.transactions = [
    {
      id: "wechat:202600000000000000000000000001",
      date: "2026-09-19T14:15:16",
      amount: -18.5,
      currency: "CNY",
      accountId: "cash",
      category: "支付宝余额",
    },
  ];
  assert.equal(A.prepare(b, p, { 账户余额: "cash" }).accepted.length, 1);
});
test("Alipay provenance and history balance behavior pass shared validation and edit/delete safeguards", () => {
  const p = A.parse(grid([r()])),
    b = A.apply(book(), A.prepare(book(), p, { 账户余额: "cash" }));
  const S = require("../legacy-safety.js"),
    N = require("../nas-model.js");
  assert.equal(S.validateBookText(JSON.stringify(b)).status, "valid");
  assert.equal(N.remove(b, b.transactions[0].id).categories.cash.balance, 100);
  assert.equal(
    N.edit(b, b.transactions[0].id, {
      accountId: "cash",
      direction: "expense",
      amount: "20",
      date: "2026-09-19",
    }).categories.cash.balance,
    100,
  );
});
