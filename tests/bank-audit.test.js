const test = require("node:test"),
  assert = require("node:assert/strict");
const W = require("../wechat-import.js"),
  S = require("../legacy-safety.js");
function book() {
  return {
    categories: {
      sgd: { id: "sgd", name: "OCBC", currency: "SGD", balance: 500 },
    },
    transactions: [],
    settings: { baseCurrency: "CNY" },
  };
}
function parsed() {
  return {
    provider: "ocbc",
    fileName: "synthetic.pdf",
    total: 1,
    skipped: [],
    errors: [],
    records: [
      {
        row: 1,
        date: "2026-07-13",
        amount: -38.82,
        currency: "SGD",
        id: "ocbc:abc",
        source: {
          version: 1,
          transactionId: "abc",
          merchantId: "",
          transactionType: "DEBIT PURCHASE",
          counterparty: "",
          product: "Test shop",
          direction: "支出",
          paymentMethod: "OCBC SGD",
          status: "已入账",
          note: "",
          timezone: "source-local",
          signature: '["2026-07-13","支出",3882]',
        },
      },
    ],
  };
}
test("bank currency preserved, history balances untouched, exact duplicate evidence persists", () => {
  const b = book(),
    p = W.prepare(b, parsed(), { "OCBC SGD": "sgd" }),
    n = W.apply(b, p);
  assert.equal(n.transactions[0].currency, "SGD");
  assert.equal(n.categories.sgd.balance, 500);
  assert.equal(n.importAudits[0].items[0].decision, "imported");
  const repeat = W.apply(n, W.prepare(n, parsed(), {}));
  assert.equal(repeat.transactions.length, 1);
  assert.equal(repeat.importAudits[1].items[0].decision, "duplicate");
  assert.equal(repeat.importAudits[1].items[0].matches[0].id, "ocbc:abc");
  assert.equal(S.validateBookText(JSON.stringify(repeat)).status, "valid");
});
test("cross-provider matches remain pending, can be excluded after reopening with evidence", () => {
  const b = book();
  b.transactions.push({
    id: "manual",
    date: "2026-07-13",
    amount: -38.82,
    currency: "SGD",
    accountId: "sgd",
    category: "sgd",
  });
  const n = W.apply(b, W.prepare(b, parsed(), { "OCBC SGD": "sgd" }));
  assert.equal(n.transactions.length, 1);
  const a = n.importAudits[0];
  assert.equal(a.items[0].decision, "pending");
  assert.equal(a.items[0].matches[0].id, "manual");
  const resolved = W.resolveAudit(
    JSON.parse(JSON.stringify(n)),
    a.id,
    0,
    "exclude",
  );
  assert.equal(resolved.importAudits[0].items[0].decision, "excluded");
  assert.equal(resolved.transactions.length, 1);
  assert.equal(resolved.importAudits[0].status, "completed");
  assert.throws(() => W.resolveAudit(resolved, a.id, 0, "include"));
});
test("pending candidate inclusion rechecks exact IDs and missing accounts", () => {
  let b = book(),
    p = parsed();
  p.records[0].needsReview = true;
  let n = W.apply(b, W.prepare(b, p, { "OCBC SGD": "sgd" })),
    a = n.importAudits[0];
  const removed = JSON.parse(JSON.stringify(n));
  removed.categories = {};
  assert.throws(() => W.resolveAudit(removed, a.id, 0, "include"));
  const yes = W.resolveAudit(n, a.id, 0, "include");
  assert.equal(yes.transactions.length, 1);
  assert.equal(yes.categories.sgd.balance, 500);
  assert.equal(S.validateBookText(JSON.stringify(yes)).status, "valid");
  const broken = JSON.parse(JSON.stringify(yes));
  broken.importAudits[0].items[0].decision = "garbage";
  assert.equal(S.validateBookText(JSON.stringify(broken)).status, "corrupt");
});
module.exports = { book, parsed };

test("malformed persisted matching evidence is rejected before opening a review",()=>{const b=book(),n=W.apply(b,W.prepare(b,parsed(),{'OCBC SGD':'sgd'}));n.importAudits[0].items[0].matches=[null];assert.equal(S.validateBookText(JSON.stringify(n)).status,'corrupt');});
