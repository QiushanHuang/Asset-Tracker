(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./ledger-import.js")
      : root.AssetTrackerImport,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AssetTrackerWechatImport = api;
})(globalThis, function (I) {
  "use strict";
  const required = [
    "交易时间",
    "交易类型",
    "交易对方",
    "商品",
    "收/支",
    "金额(元)",
    "支付方式",
    "当前状态",
    "交易单号",
  ];
  const clean = (v) =>
    String(v ?? "")
      .replace(/^\uFEFF/, "")
      .trim();
  const header = (v) =>
    clean(v).replace(/\s/g, "").replace(/（/g, "(").replace(/）/g, ")");
  const isHeader = (r) =>
    Array.isArray(r) && required.every((h) => r.map(header).includes(h));
  function detect(grid) {
    return Array.isArray(grid) && grid.slice(0, 100).some(isHeader);
  }
  function money(value) {
    const str = clean(value).replace(/^[¥￥]\s*/, "");
    if (!/^(?:\d+|\d{1,3}(?:,\d{3})+)(?:\.\d{1,2})?$/.test(str))
      throw Error("金额须为非负数字，最多两位小数");
    const n = Number(str.replace(/,/g, "")),
      cents = Math.round(n * 100);
    if (!Number.isSafeInteger(cents) || cents > 1e14)
      throw Error("金额超出可处理范围");
    return cents;
  }
  function identifier(value) {
    if (typeof value !== "string")
      throw Error("交易单号必须是文本；Excel 数值可能已丢失精度，请重新导出");
    const id = clean(value).replace(/^'/, "");
    if (!/^[A-Za-z0-9_-]{1,120}$/.test(id))
      throw Error("交易单号缺失或格式不支持");
    return id;
  }
  function parse(grid) {
    if (!Array.isArray(grid)) throw Error("微信账单格式无效");
    const index = grid.slice(0, 100).findIndex(isHeader);
    if (index < 0)
      throw Error("未找到微信账单明细表头，请选择微信导出的原始账单");
    if (grid.slice(index + 1).some(isHeader))
      throw Error("发现重复表头，请将不同账单分别导入");
    const labels = grid[index].map(header);
    if (new Set(labels.filter(Boolean)).size !== labels.filter(Boolean).length)
      throw Error("账单表头有重复字段");
    const at = (k) => labels.indexOf(k);
    const result = {
      provider: "wechat",
      headerRow: index + 1,
      total: 0,
      records: [],
      skipped: [],
      errors: [],
      totals: { incomeCents: 0, expenseCents: 0 },
      methods: [],
    };
    const methods = new Map();
    for (let i = index + 1; i < grid.length; i++) {
      const row = grid[i];
      if (!row || row.every((v) => clean(v) === "")) continue;
      result.total++;
      if (result.total > 50000) throw Error("单次微信导入最多 50,000 笔");
      const get = (k) => (at(k) < 0 ? "" : row[at(k)]);
      const line = i + 1;
      try {
        const direction = clean(get("收/支")),
          status = clean(get("当前状态")),
          type = clean(get("交易类型"));
        if (
          [
            "支付失败",
            "交易失败",
            "交易关闭",
            "已关闭",
            "已取消",
            "已撤销",
            "待支付",
            "等待付款",
            "待收款",
            "等待对方收款",
            "对方未收款",
          ].includes(status)
        ) {
          result.skipped.push({
            row: line,
            reason: "未完成或已关闭交易：" + status,
          });
          continue;
        }
        if (
          ["/", "不计收支", "中性交易", "不计收入", "不计支出"].includes(
            direction,
          )
        ) {
          result.skipped.push({
            row: line,
            reason: "中性交易不自动计入收支，请按账户转账核对",
          });
          continue;
        }
        if (!["收入", "支出"].includes(direction))
          throw Error("收支方向不明确");
        const transactionId = identifier(get("交易单号")),
          date = I.date(get("交易时间")),
          cents = money(get("金额(元)")),
          amount = direction === "支出" ? -cents / 100 : cents / 100;
        const source = {
          version: 1,
          transactionId,
          merchantId: clean(get("商户单号")),
          transactionType: type,
          counterparty: clean(get("交易对方")),
          product: clean(get("商品")),
          direction,
          paymentMethod: clean(get("支付方式")) || "未注明",
          status,
          note: clean(get("备注")),
          timezone: "UTC+08:00",
          signature: JSON.stringify([date, direction, cents]),
        };
        if (
          Object.values(source).some(
            (v) => typeof v === "string" && v.length > 1000,
          )
        )
          throw Error("微信字段过长");
        const known =
          [
            "支付成功",
            "交易成功",
            "对方已收钱",
            "已收钱",
            "已存入零钱",
            "已转账",
            "已到账",
            "转账成功",
            "收款成功",
            "已收款",
            "退款成功",
            "对方已退还",
          ].includes(status) ||
          /^已(?:全额|部分)?退款(?:[（(]?[¥￥]?\d+(?:\.\d{1,2})?[）)]?)?$/.test(
            status,
          );
        const neutralType = [
          "零钱充值",
          "零钱提现",
          "充值",
          "提现",
          "信用卡还款",
          "零钱通转入",
          "零钱通转出",
          "理财通申购",
          "理财通赎回",
        ].includes(type);
        const record = {
          row: line,
          id: "wechat:" + transactionId,
          date,
          amount,
          cents,
          source,
          needsReview: !known || neutralType,
          reviewReason: neutralType
            ? "资金划转类型与收支方向需核对"
            : !known
              ? "尚未识别的交易状态：" + (status || "空白")
              : "",
        };
        result.records.push(record);
        methods.set(
          source.paymentMethod,
          (methods.get(source.paymentMethod) || 0) + 1,
        );
        const key = direction === "收入" ? "incomeCents" : "expenseCents";
        result.totals[key] += cents;
        if (!Number.isSafeInteger(result.totals[key]))
          throw Error("累计金额超出安全精度");
      } catch (error) {
        result.errors.push({ row: line, message: error.message });
      }
    }
    const declared = grid
      .slice(0, index)
      .flat()
      .map(clean)
      .join(" ")
      .match(/共\s*(\d+)\s*笔记录/);
    if (declared && Number(declared[1]) !== result.total)
      throw Error("账单声明的记录数量与实际明细不一致，可能读取不完整");
    result.methods = [...methods].map(([name, count]) => ({ name, count }));
    return result;
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
        if (workbook.Workbook?.WBProps?.date1904) {
          const headerIndex = grid.findIndex(isHeader),
            dateIndex = grid[headerIndex].map(header).indexOf("交易时间");
          for (let i = headerIndex + 1; i < grid.length; i++)
            if (typeof grid[i]?.[dateIndex] === "number")
              grid[i][dateIndex] += 1462;
        }
        if (found) throw Error("包含多个微信账单工作表，请分别导入");
        found = parse(grid);
        found.sheet = name;
      }
    }
    if (!found) throw Error("未识别到微信支付账单");
    return found;
  }
  function financialKey(t) {
    return JSON.stringify([
      t.date.slice(0, 10),
      t.currency || "CNY",
      Math.round(t.amount * 100),
    ]);
  }
  function prepare(book, parsed, mapping = {}) {
    const provider = parsed.provider || "wechat";
    if (!["wechat", "alipay", "icbc", "ocbc"].includes(provider))
      throw Error("不支持的账单来源");
    const providerName = {
      wechat: "微信",
      alipay: "支付宝",
      icbc: "工商银行",
      ocbc: "OCBC",
    }[provider];
    const accounts = I.accounts(book),
      byAccount = new Map(accounts.map((a) => [a.node.id, a]));
    const existing = new Map(book.transactions.map((t) => [t.id, t]));
    const manual = new Map();
    for (const t of book.transactions) {
      if (
        t[provider] ||
        (["wechat", "alipay"].includes(provider) &&
          (t.wechat || t.alipay || /^(wechat|alipay):/.test(String(t.id))))
      )
        continue;
      const k = financialKey(t);
      if (!manual.has(k)) manual.set(k, []);
      manual.get(k).push(t);
    }
    const plan = {
      provider,
      fileName: parsed.fileName || "",
      verification: parsed.verification || [],
      source: JSON.stringify(book),
      total: parsed.total,
      accepted: [],
      review: [],
      duplicates: [],
      skipped: [...parsed.skipped],
      errors: [...parsed.errors],
      warnings: [],
    };
    const seen = new Map();
    for (const r of parsed.records) {
      const prior = existing.get(r.id),
        already = seen.get(r.id);
      if (already) {
        if (already !== r.source.signature)
          plan.errors.push({
            row: r.row,
            message: "同一交易单号存在不同金额或时间",
          });
        else
          plan.duplicates.push({
            row: r.row,
            reason: "文件内重复交易标识",
            sourceId: r.id,
            matches: [{ id: r.id }],
          });
        continue;
      }
      seen.set(r.id, r.source.signature);
      if (prior) {
        const same = prior[provider]
          ? prior[provider].signature === r.source.signature
          : prior.date === r.date &&
            prior.amount === r.amount &&
            (prior.currency || "CNY") === (r.currency || "CNY");
        if (!same)
          plan.errors.push({
            row: r.row,
            message:
              "该" +
              providerName +
              "交易单号已存在，但原始金额或时间不同，请核对",
          });
        else {
          plan.duplicates.push({
            row: r.row,
            transaction: prior,
            sourceId: r.id,
            reason: "相同来源标识与原始财务信息",
            matches: [evidence(prior)],
          });
          if (prior[provider] && prior[provider].status !== r.source.status)
            plan.warnings.push({
              row: r.row,
              message:
                "已有流水的" +
                providerName +
                "状态发生变化，保留原账本、不重复记账",
            });
        }
        continue;
      }
      const account = byAccount.get(mapping[r.source.paymentMethod]);
      if (
        !account ||
        (account.node.currency || book.settings.baseCurrency) !==
          (r.currency || "CNY")
      ) {
        plan.errors.push({
          row: r.row,
          code: "account-mapping",
          method: r.source.paymentMethod,
          message:
            "请为支付方式“" +
            r.source.paymentMethod +
            "”选择 " +
            (r.currency || "CNY") +
            " 资金账户",
        });
        continue;
      }
      const description = [
        r.source.counterparty,
        r.source.product,
        r.source.note,
      ]
        .filter((v) => v && v !== "/")
        .join(" · ");
      if (description.length > 2000) {
        plan.errors.push({ row: r.row, message: "交易描述过长，请核对原文件" });
        continue;
      }
      const transaction = {
        id: r.id,
        date: r.date,
        includeTime: r.date.includes("T"),
        category: account.path[0],
        subcategory: account.path.length > 1 ? account.path.at(-1) : "",
        accountId: account.node.id,
        amount: r.amount,
        currency: r.currency || "CNY",
        type: "单次",
        purpose: r.source.transactionType,
        description,
        [provider]: { ...r.source },
      };
      const matches = (manual.get(financialKey(transaction)) || []).filter(
        (t) =>
          !t.accountId ||
          t.accountId === transaction.accountId ||
          Boolean(t.icbc || t.ocbc || transaction.icbc || transaction.ocbc),
      );
      const possible = matches.length > 0;
      const item = {
        row: r.row,
        transaction,
        matches: matches.map(evidence),
        reason: [
          r.reviewReason,
          possible
            ? "存在同日同币种同金额的记录，请核对是否已记账（可能来自其他支付平台）"
            : "",
        ]
          .filter(Boolean)
          .join("；"),
      };
      (r.needsReview || possible ? plan.review : plan.accepted).push(item);
    }
    return plan;
  }
  function apply(
    book,
    plan,
    { includeReview = false, adjustBalances = false, reviewIds = [] } = {},
  ) {
    if (JSON.stringify(book) !== plan.source)
      throw Error("账本已有变化，请重新预览");
    if (plan.errors.length) throw Error("请先修正导入错误并完成账户对应");
    const next = JSON.parse(JSON.stringify(book)),
      accounts = new Map(I.accounts(next).map((a) => [a.node.id, a.node]));
    for (const { transaction: t } of [
      ...plan.accepted,
      ...(includeReview
        ? plan.review
        : plan.review.filter((item) =>
            reviewIds.includes(item.transaction.id),
          )),
    ]) {
      const copied = JSON.parse(JSON.stringify(t));
      copied[plan.provider || "wechat"].balanceMode = adjustBalances
        ? "apply"
        : "history";
      next.transactions.push(copied);
      if (adjustBalances) {
        const a = accounts.get(t.accountId);
        if (!a) throw Error("资金账户不存在");
        a.balance = Number(
          (a.balance + (a.isDebt ? -t.amount : t.amount)).toPrecision(15),
        );
        if (!Number.isFinite(a.balance)) throw Error("账户余额超出范围");
      }
    }
    const selected = new Set(
      includeReview ? plan.review.map((i) => i.transaction.id) : reviewIds,
    );
    const now = new Date().toISOString();
    const entry = (item, decision) => ({
      row: item.row || 0,
      sourceId: item.sourceId || item.transaction?.id || "",
      reason: item.reason || "",
      matches: item.matches || [],
      decision,
      decidedAt: decision === "pending" ? "" : now,
      ...(item.transaction
        ? decision === "pending" || plan.review.includes(item)
          ? { candidate: item.transaction }
          : { record: evidence(item.transaction) }
        : {}),
    });
    const items = [
      ...plan.accepted.map((i) => entry(i, "imported")),
      ...plan.review.map((i) =>
        entry(i, selected.has(i.transaction.id) ? "imported" : "pending"),
      ),
      ...plan.duplicates.map((i) => entry(i, "duplicate")),
      ...plan.skipped.map((i) => entry(i, "skipped")),
    ];
    next.importAudits ||= [];
    next.importAudits.push({
      version: 1,
      id:
        "audit-" +
        Date.now().toString(36) +
        "-" +
        Math.random().toString(36).slice(2),
      provider: plan.provider || "wechat",
      fileName: plan.fileName || "",
      createdAt: now,
      adjustBalances,
      status: items.some((i) => i.decision === "pending")
        ? "pending"
        : "completed",
      items,
      verification: plan.verification || [],
    });
    return next;
  }
  function evidence(t) {
    return {
      id: t.id,
      date: t.date,
      amount: t.amount,
      currency: t.currency || "CNY",
      description: t.description || "",
      accountId: t.accountId || "",
    };
  }
  function resolveAudit(book, auditId, index, decision) {
    if (!["include", "exclude"].includes(decision))
      throw Error("请选择保留或排除");
    const next = JSON.parse(JSON.stringify(book)),
      audit = next.importAudits?.find((a) => a.id === auditId),
      item = audit?.items[index];
    if (!item || item.decision !== "pending")
      throw Error("该记录已处理或不存在，请刷新");
    if (decision === "include") {
      const t = item.candidate,
        prior = next.transactions.find((x) => x.id === t.id);
      if (prior) {
        if (prior[audit.provider]?.signature !== t[audit.provider]?.signature)
          throw Error("同一流水标识出现冲突，请重新核对");
        item.decision = "duplicate";
        item.matches = [evidence(prior)];
        item.reason += "；核对时发现流水已存在";
      } else {
        const a = I.accounts(next).find((a) => a.node.id === t.accountId)?.node;
        if (!a || (a.currency || next.settings.baseCurrency) !== t.currency)
          throw Error("原资金账户已删除或币种变化，请重新导入并对应账户");
        t[audit.provider].balanceMode = audit.adjustBalances
          ? "apply"
          : "history";
        next.transactions.push(t);
        if (audit.adjustBalances) {
          a.balance = Number(
            (a.balance + (a.isDebt ? -t.amount : t.amount)).toPrecision(15),
          );
          if (!Number.isFinite(a.balance)) throw Error("余额超出范围");
        }
        item.decision = "imported";
      }
    } else item.decision = "excluded";
    item.decidedAt = new Date().toISOString();
    // Keep the original candidate and matching evidence for later audit.
    audit.status = audit.items.some((i) => i.decision === "pending")
      ? "pending"
      : "completed";
    return next;
  }
  return { detect, parse, readWorkbook, prepare, apply, resolveAudit };
});
