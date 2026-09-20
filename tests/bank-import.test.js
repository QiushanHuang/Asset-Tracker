const test = require("node:test"),
  assert = require("node:assert/strict"),
  B = require("../bank-import.js");
const item = (s, x, y) => ({ s, x, y, angle: 0 });
function ocbc() {
  return [
    {
      number: 1,
      width: 595.28,
      height: 841.89,
      items: [
        item("OCBC FRANK ACCOUNT", 46, 240),
        item("Account No. 12345001", 46, 260),
        item("1 JUL 2026 TO 31 JUL 2026", 450, 240),
        item("Withdrawal", 331, 290),
        item("Deposit", 426, 290),
        item("BALANCE B/F", 136, 306),
        item("100.00", 535, 306),
        item("13 JUL", 46, 320),
        item("13 JUL", 92, 320),
        item("DEBIT PURCHASE", 136, 320),
        item("10.00", 360, 320),
        item("90.00", 535, 320),
        item("TEST SHOP", 136, 334),
        item("13 JUL", 46, 350),
        item("13 JUL", 92, 350),
        item("DEBIT PURCHASE", 136, 350),
        item("10.00", 360, 350),
        item("80.00", 535, 350),
        item("TEST SHOP", 136, 364),
        item("BALANCE C/F", 136, 390),
        item("80.00", 535, 390),
        item("Total Withdrawals/Deposits", 136, 420),
        item("20.00", 360, 420),
        item("0.00", 440, 420),
      ],
    },
  ];
}
function icbc() {
  return [
    {
      number: 1,
      width: 842,
      height: 595,
      items: [
        item("中国工商银行借记账户历史明细", 200, 25),
        item("交易日期", 94, 63),
        item("2026-07-13", 91, 77),
        item("12:03:04", 94, 84),
        item("12345678", 139, 81),
        item("活期", 220, 81),
        item("00000", 251, 81),
        item("新加坡元", 282, 81),
        item("汇", 317, 81),
        item("利息", 346, 81),
        item("1901", 383, 81),
        item("+1.25", 441, 81),
        item("101.25", 524, 81),
        item("测试银行", 600, 81),
        item("（空）", 667, 81),
        item("批量业务", 723, 81),
        item("本页交易笔数：1", 80, 540),
        item("本页收入算术合计：1.25", 400, 530),
        item("本页支出算术合计：0.00", 80, 530),
      ],
    },
  ];
}
test("OCBC same-day identical payments remain distinct by running balance; IDs survive page numbering", () => {
  const p = B.parse(ocbc());
  assert.equal(p.total, 2);
  assert.equal(p.records[0].currency, "SGD");
  assert.notEqual(p.records[0].id, p.records[1].id);
  const pages = ocbc();
  pages[0].number = 3;
  assert.equal(B.parse(pages).records[0].id, p.records[0].id);
});
test("OCBC checks complete statement and rejects missing rows, wrong balances and totals", () => {
  for (const value of ["100.00", "90.00", "80.00", "20.00"]) {
    const p = ocbc();
    p[0].items.find((i) => i.s === value).s = "777.00";
    assert.throws(() => B.parse(p));
  }
  const p = ocbc();
  p[0].items = p[0].items.filter((i) => i.y < 350 || i.y > 364);
  assert.throws(() => B.parse(p));
});
test("ICBC handles rotated-normalized columns, currency, seconds, and page totals", () => {
  const p = B.parse(icbc());
  assert.equal(p.total, 1);
  assert.equal(p.records[0].currency, "SGD");
  assert.equal(p.records[0].date, "2026-07-13T12:03:04");
  assert.equal(p.records[0].amount, 1.25);
  const bad = icbc();
  bad[0].items.find((i) => i.s === "本页交易笔数：1").s = "本页交易笔数：2";
  assert.throws(() => B.parse(bad));
});
test("unknown layout and image-only PDF fail closed", () => {
  assert.throws(() => B.parse([]));
  assert.throws(() => B.parse([{ items: [item("Invoice", 0, 0)] }]));
});
module.exports = { ocbc, icbc };
