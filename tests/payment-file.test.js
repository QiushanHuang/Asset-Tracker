const test = require("node:test"),
  assert = require("node:assert/strict"),
  fs = require("node:fs");
const F = require("../payment-file.js"),
  X = require("../vendor/xlsx.full.min.js"),
  A = require("../alipay-import.js");
test("GB18030 and UTF-8 CSV both retain Chinese and full-length identifiers", () => {
  const gb = fs.readFileSync(
    require.resolve("./fixtures/alipay-synthetic-gb18030.csv"),
  );
  for (const [input, encoding] of [
    [gb, "gb18030"],
    [Buffer.from(new TextDecoder("gb18030").decode(gb)), "utf-8"],
  ]) {
    const result = F.read(input, X, { type: "array" });
    assert.equal(result.encoding, encoding);
    const p = A.readWorkbook(result.workbook, X);
    assert.equal(p.records[0].source.counterparty, "测试商户");
    assert.equal(
      p.records[0].source.transactionId,
      "202600000000000000000000000001",
    );
    assert.equal(p.records[0].amount, -12.3);
  }
});
test("empty input and oversized files are rejected before parsing", () => {
  assert.throws(() => F.read(new Uint8Array(), X), /空/);
  assert.throws(() => F.read(new Uint8Array(12 * 1024 * 1024 + 1), X), /12MB/);
});
