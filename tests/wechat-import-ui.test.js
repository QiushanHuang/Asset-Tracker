const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const { JSDOM } = require("../app/node_modules/jsdom");
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
function fixture(t, onCommit) {
  const dom = new JSDOM('<button id="trigger">导入微信账单</button>', {
    runScripts: "outside-only",
  });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  for (const f of [
    "ledger-import.js",
    "wechat-import.js",
    "wechat-import-ui.js",
  ])
    dom.window.eval(fs.readFileSync(require.resolve("../" + f), "utf8"));
  const book = {
    categories: {
      cash: { id: "cash", name: "微信零钱", currency: "CNY", balance: 100 },
    },
    transactions: [],
    settings: { baseCurrency: "CNY", exchangeRates: { CNY: 1 } },
  };
  const parsed = dom.window.AssetTrackerWechatImport.parse([
    heads,
    [
      "2026-09-19 12:01:00",
      "商户消费",
      "<img src=x onerror=alert(1)>",
      "午餐",
      "支出",
      10,
      "零钱",
      "支付成功",
      "wechat-test-001",
      "merchant-001",
      "/",
    ],
  ]);
  dom.window.document.getElementById("trigger").focus();
  const result = dom.window.AssetTrackerWechatUI.open({
    parsed,
    getBook: () => book,
    onCommit,
  });
  t.after(() => dom.window.close());
  return { dom, doc: dom.window.document, book, result };
}
async function tick() {
  await new Promise((r) => setImmediate(r));
}
test("review escapes source text, requires account mapping and defaults to history-only", async (t) => {
  let candidate;
  const f = fixture(t, async (b) => (candidate = b));
  assert.equal(f.doc.querySelector("[data-wechat-confirm]").disabled, true);
  const select = f.doc.querySelector("[data-wechat-method]");
  select.value = "cash";
  select.dispatchEvent(new f.dom.window.Event("change", { bubbles: true }));
  assert.equal(f.doc.querySelector(".wechat-records img"), null);
  assert.match(f.doc.querySelector(".wechat-records").textContent, /<img/);
  f.doc.querySelector("[data-wechat-confirm]").click();
  assert.equal(await f.result, true);
  assert.equal(candidate.categories.cash.balance, 100);
  assert.equal(candidate.transactions[0].wechat.balanceMode, "history");
  assert.equal(f.doc.querySelector("dialog"), null);
  assert.equal(f.doc.activeElement.id, "trigger");
});
test("durable save failure keeps the dialog and selection, while success waits for acknowledgment", async (t) => {
  let reject, resolve;
  const f = fixture(
    t,
    () =>
      new Promise((yes, no) => {
        resolve = yes;
        reject = no;
      }),
  );
  const s = f.doc.querySelector("[data-wechat-method]");
  s.value = "cash";
  s.dispatchEvent(new f.dom.window.Event("change", { bubbles: true }));
  const b = f.doc.querySelector("[data-wechat-confirm]");
  b.click();
  assert.equal(b.disabled, true);
  assert.ok(f.doc.querySelector("dialog"));
  reject(Error("storage failed"));
  await tick();
  assert.match(
    f.doc.querySelector(".wechat-feedback").textContent,
    /storage failed/,
  );
  assert.equal(s.value, "cash");
  assert.equal(b.disabled, false);
  b.click();
  resolve();
  assert.equal(await f.result, true);
});
test("stale preview and cancellation never commit", async (t) => {
  let writes = 0;
  const f = fixture(t, async () => writes++);
  const s = f.doc.querySelector("[data-wechat-method]");
  s.value = "cash";
  s.dispatchEvent(new f.dom.window.Event("change", { bubbles: true }));
  f.book.memo = "external edit";
  f.doc.querySelector("[data-wechat-confirm]").click();
  await tick();
  assert.equal(writes, 0);
  assert.match(f.doc.querySelector(".wechat-feedback").textContent, /变化/);
  f.doc.querySelector("[data-wechat-cancel]").click();
  assert.equal(await f.result, false);
  assert.equal(f.book.memo, "external edit");
});
test("Alipay review can select only yield while leaving refunds excluded and preserving keyboard focus", async (t) => {
  const dom = new JSDOM("", { runScripts: "outside-only" });
  dom.window.HTMLDialogElement.prototype.showModal = function () {
    this.open = true;
  };
  dom.window.HTMLDialogElement.prototype.close = function () {
    this.open = false;
  };
  t.after(() => dom.window.close());
  for (const f of [
    "ledger-import.js",
    "wechat-import.js",
    "alipay-import.js",
    "wechat-import-ui.js",
  ])
    dom.window.eval(fs.readFileSync(require.resolve("../" + f), "utf8"));
  const h = [
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
  ];
  const parsed = dom.window.AssetTrackerAlipayImport.parse([
    h,
    [
      "2026-09-19 12:00:00",
      "退款",
      "测试商户",
      "test",
      "退款",
      "不计收支",
      "10",
      "账户余额",
      "退款成功",
      "refund-001",
      "",
      "",
    ],
    [
      "2026-09-19 13:00:00",
      "投资理财",
      "余额宝",
      "test",
      "余额宝-收益发放",
      "不计收支",
      "1.20",
      "账户余额",
      "交易成功",
      "yield-001",
      "",
      "",
    ],
  ]);
  const book = {
    categories: {
      cash: { id: "cash", name: "支付宝", balance: 100, currency: "CNY" },
    },
    transactions: [],
    settings: { baseCurrency: "CNY", exchangeRates: { CNY: 1 } },
  };
  let saved;
  const done = dom.window.AssetTrackerWechatUI.open({
    parsed,
    getBook: () => book,
    onCommit: async (b) => (saved = b),
  });
  const doc = dom.window.document,
    select = doc.querySelector("[data-wechat-method]");
  select.value = "cash";
  select.dispatchEvent(new dom.window.Event("change", { bubbles: true }));
  const checkbox = doc.querySelector(
    '[data-wechat-review-id="alipay:yield-001"]',
  );
  checkbox.focus();
  checkbox.click();
  assert.equal(doc.activeElement, checkbox);
  doc.querySelector("[data-wechat-confirm]").click();
  await done;
  assert.equal(saved.transactions.length, 1);
  assert.equal(saved.transactions[0].alipay.transactionId, "yield-001");
  assert.equal(saved.categories.cash.balance, 100);
});
