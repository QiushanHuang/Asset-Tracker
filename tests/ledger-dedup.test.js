const test = require("node:test");
const assert = require("node:assert/strict");
const fs = require("node:fs");
const path = require("node:path");
const vm = require("node:vm");
const modulePath = path.join(__dirname, "../ledger-dedup.js");
const D = fs.existsSync(modulePath) ? require(modulePath) : {};
const tx = (extra = {}) => ({
  id: "a", date: "2026-10-02", accountId: "cash", category: "现金",
  amount: -28.5, currency: "CNY", description: "星巴克 Coffee", ...extra,
});
const book = () => ({
  settings: { baseCurrency: "CNY" },
  categories: { cash: { id: "cash", name: "现金" } },
});
function compare(a, b, options) {
  assert.equal(typeof D.compare, "function", "shared duplicate comparison API is required");
  return D.compare(a, b, options);
}

test("same stable identity is exact and comparison never changes inputs", () => {
  const a = tx(), b = tx(), before = JSON.stringify([a, b]);
  assert.equal(compare(a, b).level, "exact");
  assert.equal(JSON.stringify([a, b]), before);
});

test("trusted provider and source ID survive different local record IDs", () => {
  const sourceIdentity = { provider: "wechat", id: "order-001" };
  const match = compare(tx({ sourceIdentity }), tx({ id: "b", sourceIdentity }));
  assert.equal(match.level, "exact");
  assert.match(match.reasons.join(" "), /来源/);
});

test("identity conflicts report core differences instead of hiding changed values", () => {
  for (const change of [{ amount: -29 }, { amount: 28.5 }, { currency: "USD" },
    { accountId: "card" }, { date: "2026-10-03" },
    { date: "2026-10-02T13:00", description: "other" }]) {
    const a = tx({ date: "2026-10-02T12:00" });
    const match = compare(a, tx({ ...a, ...change }));
    assert.equal(match.level, "conflict");
    assert.ok(match.differences.length > 0);
  }
  const sourceIdentity = { provider: "wechat", id: "order-001" };
  assert.equal(compare(tx({ sourceIdentity }), tx({ id: "b", sourceIdentity, amount: -29 })).level, "conflict");
});

test("different account, currency, direction, amount or day excludes content matches", () => {
  for (const change of [{ amount: -29 }, { amount: 28.5 }, { currency: "USD" },
    { accountId: "card" }, { date: "2026-10-03" }]) {
    assert.equal(compare(tx(), tx({ id: "b", ...change })), null);
  }
});

test("classification and project edits explain differences without preventing a match", () => {
  const match = compare(tx(), tx({ id: "b", purpose: "餐饮", projectId: "travel", expenseCategoryId: "food" }));
  assert.equal(match.level, "high");
  assert.match(match.differences.join(" "), /用途|分类/);
  assert.match(match.differences.join(" "), /项目/);
});

test("full width, case, repeated whitespace and time precision normalize", () => {
  const match = compare(tx({ date: "2026-10-02 12:00", description: "  星巴克　ＣＯＦＦＥＥ  " }),
    tx({ id: "b", date: "2026-10-02T12:00:30", description: "星巴克 coffee" }));
  assert.equal(match.level, "high");
});

test("same-day amounts without merchant evidence remain possible", () => {
  const match = compare(tx({ description: "" }), tx({ id: "b", description: "" }));
  assert.equal(match.level, "possible");
  assert.match(match.reasons.join(" "), /描述|商户/);
});

test("generic payment labels are insufficient merchant evidence", () => {
  for (const description of ["消费", "付款", "转账", "其他", "--", "N/A"]) {
    assert.equal(compare(tx({ description }), tx({ id: "b", description })).level, "possible");
  }
});

test("a local ID with changed description is a conflict, while source identity tolerates merchant wording", () => {
  assert.equal(compare(tx(), tx({ description: "便利店" })).level, "conflict");
  const sourceIdentity = { provider: "bank", id: "order-1" };
  const match = compare(tx({ sourceIdentity }), tx({ id: "b", sourceIdentity, description: "付款至星巴克" }));
  assert.equal(match.level, "exact");
  assert.match(match.differences.join(" "), /描述/);
});

test("different precise times remain possible repeated purchases and are explained", () => {
  const match = compare(tx({ date: "2026-10-02T08:30:00" }), tx({ id: "b", date: "2026-10-02T18:30:00" }));
  assert.equal(match.level, "possible");
  assert.match(match.differences.join(" "), /时间/);
});

test("mild merchant differences are possible but unrelated merchants are excluded", () => {
  assert.equal(compare(tx({ description: "星巴克咖啡店" }), tx({ id: "b", description: "星巴克咖啡" })).level, "possible");
  assert.equal(compare(tx({ description: "午餐" }), tx({ id: "b", description: "打车" })), null);
});

test("source identifiers are scoped by provider and keep their own case", () => {
  const a = tx({ sourceIdentity: { provider: "wechat", id: "shared-id" } });
  const b = tx({ id: "b", sourceIdentity: { provider: "alipay", id: "shared-id" } });
  assert.equal(compare(a, b).level, "possible");
  assert.equal(compare(a, tx({ id: "b", amount: -30, sourceIdentity: b.sourceIdentity })), null);
  assert.equal(compare(a, tx({ id: "b", sourceIdentity: { provider: "wechat", id: "different-id" } })), null);
  assert.equal(compare(tx({ sourceIdentity: { provider: "bank", id: "ABC" } }),
    tx({ id: "b", sourceIdentity: { provider: "bank", id: "abc" } })), null);
});

test("unknown statement providers never establish a trusted transaction identity", () => {
  for (const provider of ["statement", "unknown", "", "ＳＴＡＴＥＭＥＮＴ"]) {
    const sourceIdentity = { provider, id: "generic-order-1" };
    const a = tx({ sourceIdentity }), b = tx({ id: "b", sourceIdentity });
    assert.equal(compare(a, b).level, "high");
    assert.equal(compare(a, { ...b, amount: -99 }), null);
    assert.equal(D.createIndex([a]).findMatches({ ...b, amount: -99 }).length, 0);
  }
  const sourceIdentity = { provider: "招商银行", id: "bank-order-1" };
  assert.equal(compare(tx({ sourceIdentity }), tx({ id: "b", sourceIdentity })).level, "exact");
});

test("old account labels resolve only against a unique leaf in the supplied book", () => {
  const b = book();
  const legacy = tx({ accountId: undefined });
  assert.equal(compare(legacy, tx({ id: "b" }), { book: b }).level, "high");
  assert.equal(compare(legacy, tx({ id: "b" })), null);
  b.categories.other = { id: "other", name: "现金" };
  assert.equal(compare(legacy, tx({ id: "b" }), { book: b }), null);
});

test("nested duplicate account names never collapse into the same account", () => {
  const b = { settings: { baseCurrency: "CNY" }, categories: { bank: { name: "银行", children: {
    debit: { name: "借记", children: { card: { id: "card-a", name: "主卡" } } },
    credit: { name: "信用", children: { card: { id: "card-b", name: "主卡" } } },
  } } } };
  assert.equal(compare(tx({ accountId: undefined, category: "银行", subcategory: "主卡" }),
    tx({ id: "b", accountId: "card-a" }), { book: b }), null);
});

test("invalid dates and non-finite or blank amounts are never content duplicates", () => {
  for (const change of [{ date: "2026-02-30" }, { date: "invalid" }, { amount: NaN }, { amount: Infinity }, { amount: "" }, { amount: null }]) {
    assert.equal(compare(tx({ ...change }), tx({ id: "b", ...change })), null);
  }
});

test("matching timestamps with explicit offsets compare as the same instant", () => {
  assert.equal(compare(tx({ date: "2026-10-02T08:15:00+08:00" }),
    tx({ id: "b", date: "2026-10-02T00:15:00Z" })).level, "high");
});

test("separate transfer identities are not collapsed just because their amounts match", () => {
  assert.equal(compare(tx({ transferId: "move-1" }), tx({ id: "b", transferId: "move-2" })), null);
  assert.equal(compare(tx({ transferId: "move-1", accountId: "cash", amount: -10 }),
    tx({ id: "b", transferId: "move-1", accountId: "card", amount: 10 })), null);
});

test("matches are capped at twenty with stable strength ordering and total count", () => {
  assert.equal(typeof D.findMatches, "function");
  const sourceIdentity = { provider: "wechat", id: "one" }, candidate = tx({ sourceIdentity });
  const items = Array.from({ length: 26 }, (_, i) => tx({ id: `b-${i}`, description: i < 3 ? "" : "星巴克 Coffee" }));
  items.push(tx({ id: "conflict", sourceIdentity, amount: -100 }), tx({ id: "exact", sourceIdentity }));
  const matches = D.findMatches(candidate, items);
  assert.equal(matches.length, 20);
  assert.equal(matches.total, 28);
  assert.deepEqual(matches.slice(0, 3).map(x => [x.transactionId, x.level]), [["conflict", "conflict"], ["exact", "exact"], ["b-3", "high"]]);
});

test("scan returns observed pairs without treating similarity as transitive", () => {
  assert.equal(typeof D.scan, "function");
  const items = [tx({ id: "left", description: "ABCDE" }), tx({ id: "middle", description: "ABCDF" }), tx({ id: "right", description: "ABCGF" })];
  assert.deepEqual(D.scan(items).map(x => [x.leftId, x.rightId]), [["left", "middle"], ["middle", "right"]]);
});

test("scan respects a pair limit and reports an incomplete scan without enumerating metadata", () => {
  const items = Array.from({ length: 8 }, (_, i) => tx({ id: `row-${i}` }));
  const pairs = D.scan(items, { limit: 3 });
  assert.equal(pairs.length, 3);
  assert.equal(pairs.truncated, true);
  assert.equal(Object.keys(pairs).includes("truncated"), false);
  assert.deepEqual(pairs.map(x => [x.leftId, x.rightId]), [["row-0", "row-1"], ["row-0", "row-2"], ["row-1", "row-2"]]);
});

test("scan reports completion if the final processed row exactly fills the limit", () => {
  const pairs = D.scan([tx(), tx({ id: "b" })], { limit: 1 });
  assert.equal(pairs.length, 1);
  assert.equal(pairs.truncated, false);
  assert.equal(D.scan([]).truncated, false);
});

test("dense fifty-thousand-record scans stop before reading later rows", () => {
  const items = Array.from({ length: 50000 }, (_, i) => tx({ id: `row-${i}` }));
  Object.defineProperty(items, 150, { get() { assert.fail("scan must stop once its result limit is reached"); } });
  const pairs = D.scan(items);
  assert.equal(pairs.length, 10000);
  assert.equal(pairs.truncated, true);
});

test("scan rejects invalid limits instead of silently doing an unbounded scan", () => {
  for (const limit of [0, -1, 1.5, Infinity, NaN, "10"]) {
    assert.throws(() => D.scan([], { limit }), /上限/);
  }
});

test("index finds identity conflicts across buckets and supports incremental imports", () => {
  assert.equal(typeof D.createIndex, "function");
  const original = tx(), index = D.createIndex([original]);
  assert.equal(index.findMatches(tx({ amount: -100, date: "2026-10-03" }))[0].level, "conflict");
  const added = tx({ id: "added", amount: -1 });
  index.add(added);
  assert.equal(index.findMatches(tx({ id: "new", amount: -1 }))[0].transactionId, "added");
  assert.equal(original.amount, -28.5);
});

test("a shared index excludes only the current draft position before comparing", () => {
  const stored = tx(), index = D.createIndex([stored]);
  const candidate = tx({ id: "draft-one" }), position = index.add(candidate);
  index.add(tx({ id: "other" }));
  const matches = index.findMatches(candidate, { excludePosition: position });
  assert.deepEqual(matches.map(x => x.transactionId), ["a", "other"]);
  assert.equal(matches.total, 2);
  assert.equal(index.stats.comparisons, 2);
  const all = index.allMatches(candidate, { excludePosition: position });
  assert.deepEqual(all.map(x => x.position), [0, 2]);
  assert.equal(index.stats.comparisons, 4);
  assert.equal(index.findMatches(candidate).length, 3);
});

test("excluding a peer position never hides the persisted record with the same ID", () => {
  const stored = tx(), candidate = tx({ amount: -99 });
  const index = D.createIndex([stored]), position = index.add(candidate);
  const matches = index.findMatches(candidate, { excludePosition: position });
  assert.equal(matches.length, 1);
  assert.equal(matches[0].transaction, stored);
  assert.equal(matches[0].level, "conflict");
});

test("a thousand distinct amounts avoid quadratic comparisons and keep inputs intact", () => {
  assert.equal(typeof D.createIndex, "function");
  const items = Array.from({ length: 2000 }, (_, i) => tx({ id: `row-${i}`, amount: -(i + 1) }));
  const before = JSON.stringify(items), index = D.createIndex(items);
  for (let i = 0; i < items.length; i++) {
    assert.equal(index.findMatches(tx({ id: `import-${i}`, amount: -(i + 1) })).length, 1);
  }
  assert.equal(index.stats.comparisons, 2000);
  assert.equal(JSON.stringify(items), before);
});

test("indexed retrieval and scan preserve the direct pairwise results", () => {
  const dates = ["2026-10-01", "2026-10-02", "2026-10-02T00:15:00Z", "2026-10-01T20:15:00-04:00", "2026-10-02T08:15:00+08:00"];
  const items = Array.from({ length: 50 }, (_, i) => tx({ id: `row-${i}`,
    amount: -(i % 3 + 1), date: dates[i % dates.length], accountId: i % 4 ? "cash" : "card",
    description: i % 7 ? "Coffee Shop" : "", sourceIdentity: i % 9 ? undefined : { provider: "bank", id: `order-${i % 2}` },
  }));
  const expectedPairs = [];
  for (let i = 0; i < items.length; i++) {
    for (let j = i + 1; j < items.length; j++) {
      const result = compare(items[i], items[j]);
      if (result) expectedPairs.push([items[i].id, items[j].id, result.level]);
    }
  }
  assert.deepEqual(D.scan(items).map(x => [x.leftId, x.rightId, x.level]), expectedPairs);
  const levels = { conflict: 0, exact: 1, high: 2, possible: 3 };
  const index = D.createIndex(items);
  for (const item of items) {
    const expected = items.flatMap(other => {
      const match = compare(item, other);
      return match ? [{ id: other.id, level: match.level }] : [];
    }).sort((a, b) => levels[a.level] - levels[b.level]);
    assert.deepEqual(index.findMatches(item).map(x => ({ id: x.transactionId, level: x.level })), expected.slice(0, 20));
  }
});

test("browser and CommonJS expose the same public API without requiring a backend", () => {
  assert.equal(typeof D.compare, "function");
  const context = vm.createContext({});
  vm.runInContext(fs.readFileSync(modulePath, "utf8"), context);
  assert.equal(typeof context.AssetTrackerDedup.compare, "function");
  assert.equal(typeof context.AssetTrackerDedup.createIndex, "function");
});
