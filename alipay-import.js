(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./wechat-import.js")
      : root.AssetTrackerWechatImport,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AssetTrackerAlipayImport = api;
})(globalThis, function (W) {
  "use strict";
  const clean = (v) =>
    String(v ?? "")
      .replace(/^\uFEFF/, "")
      .trim();
  const required = [
    "交易时间",
    "交易分类",
    "交易对方",
    "商品说明",
    "收/支",
    "金额",
    "收/付款方式",
    "交易状态",
    "交易订单号",
  ];
  const isHeader = (r) =>
    Array.isArray(r) && required.every((h) => r.map(clean).includes(h));
  function detect(grid) {
    return Array.isArray(grid) && grid.slice(0, 100).some(isHeader);
  }
  function parse(grid) {
    const index = grid.slice(0, 100).findIndex(isHeader);
    if (index < 0) throw Error("未找到支付宝交易明细表头");
    if (grid.slice(index + 1).some(isHeader))
      throw Error("发现重复表头，请分别导入账单");
    const labels = grid[index].map(clean);
    if (new Set(labels.filter(Boolean)).size !== labels.filter(Boolean).length)
      throw Error("支付宝表头含有重复字段");
    const canonical = [
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
    const input = grid.slice(0, index).map((r) => [...r]);
    input.push(canonical);
    const facts = new Map();
    for (let i = index + 1; i < grid.length; i++) {
      const r = grid[i];
      if (!r || r.every((v) => clean(v) === "")) {
        input.push([]);
        continue;
      }
      const get = (k) => (labels.indexOf(k) < 0 ? "" : r[labels.indexOf(k)]);
      const category = clean(get("交易分类")),
        product = clean(get("商品说明")),
        status = clean(get("交易状态")),
        originalDirection = clean(get("收/支"));
      let direction = originalDirection,
        skipReason = "",
        reviewReason = "";
      if (category === "账户存取" && !/手续费|服务费/.test(product)) {
        direction = "/";
        skipReason =
          "账户存取属于资金划转，不自动计入消费，请按账户转账另行核对";
      } else if (category === "信用借还") {
        direction = "/";
        skipReason = "信用借还款不自动计入消费，请按账户借还款核对";
      } else if (
        originalDirection === "不计收支" &&
        (category === "退款" || status === "退款成功")
      ) {
        direction = "收入";
        reviewReason =
          "原账单将退款列为不计收支：需确认原支出仍在账本中，避免重复冲回";
      } else if (
        originalDirection === "不计收支" &&
        category === "投资理财" &&
        /收益发放|收益到账|利息收入/.test(product)
      ) {
        direction = "收入";
        reviewReason = "原账单将投资收益列为不计收支，请确认是否计入账本收入";
      }
      if (/[&＆]/.test(clean(get("收/付款方式"))))
        reviewReason = [
          reviewReason,
          "包含组合支付或优惠，无法从此文件拆分，请核对实付金额和账户",
        ]
          .filter(Boolean)
          .join("；");
      if (category === "账户存取" && /手续费|服务费/.test(product))
        reviewReason = "账户存取中的费用需核对是否为实际支出";
      input.push([
        get("交易时间"),
        category,
        get("交易对方"),
        product,
        direction,
        get("金额"),
        get("收/付款方式"),
        status,
        get("交易订单号"),
        get("商家订单号"),
        get("备注"),
      ]);
      facts.set(i + 1, {
        originalDirection,
        counterpartyAccount: clean(get("对方账号")),
        skipReason,
        reviewReason,
      });
    }
    const parsed = W.parse(input);
    parsed.provider = "alipay";
    for (const r of parsed.records) {
      const fact = facts.get(r.row);
      r.id = "alipay:" + r.source.transactionId;
      r.source.timezone = "source-local";
      r.source.originalDirection = fact.originalDirection;
      r.source.counterpartyAccount = fact.counterpartyAccount;
      r.needsReview = r.needsReview || !!fact.reviewReason;
      r.reviewReason = [r.reviewReason, fact.reviewReason]
        .filter(Boolean)
        .join("；");
    }
    for (const r of parsed.skipped) {
      const fact = facts.get(r.row);
      if (fact?.skipReason) r.reason = fact.skipReason;
    }
    return parsed;
  }
  function readWorkbook(workbook, XLSX) {
    let found = null;
    for (const name of workbook.SheetNames) {
      const grid = XLSX.utils.sheet_to_json(workbook.Sheets[name], {
        header: 1,
        defval: "",
        raw: true,
        blankrows: true,
      });
      if (detect(grid)) {
        if (found) throw Error("包含多个支付宝账单工作表，请分别导入");
        found = parse(grid);
        found.sheet = name;
      }
    }
    if (!found) throw Error("未识别到支付宝交易明细");
    return found;
  }
  return { detect, parse, readWorkbook, prepare: W.prepare, apply: W.apply };
});
