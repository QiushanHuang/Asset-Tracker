(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AssetTrackerImport = api;
})(globalThis, function () {
  "use strict";
  const clone = (x) => JSON.parse(JSON.stringify(x));
  const text = (x) => String(x ?? "").trim();
  let sequence = 0;
  function accounts(book) {
    const list = [];
    function walk(nodes, path = []) {
      for (const n of Object.values(nodes)) {
        const next = [...path, n.name];
        if (n.children && Object.keys(n.children).length)
          walk(n.children, next);
        else list.push({ node: n, path: next });
      }
    }
    walk(book.categories);
    return list;
  }
  function rate(book, currency) {
    const n =
      currency === book.settings.baseCurrency
        ? 1
        : book.settings.exchangeRates[currency];
    if (!Number.isFinite(n) || n <= 0) throw Error("缺少有效汇率：" + currency);
    return n;
  }
  function date(value) {
    if (typeof value === "number") {
      if (value < 61 || value > 2958465) throw Error("Excel 日期超出范围");
      value = new Date(Date.UTC(1899, 11, 30) + Math.round(value * 86400000))
        .toISOString()
        .slice(0, 19)
        .replace(/T00:00:00$/, "");
    }
    value = text(value).replace(" ", "T");
    if (!/^\d{4}-\d{2}-\d{2}(T\d{2}:\d{2}(:\d{2})?)?$/.test(value))
      throw Error("日期须为 YYYY-MM-DD 或含时间的日期");
    const day = value.slice(0, 10);
    const parsed = new Date(day + "T00:00:00Z");
    if (
      !Number.isFinite(+parsed) ||
      parsed.toISOString().slice(0, 10) !== day ||
      (value.includes("T") &&
        (Number(value.slice(11, 13)) > 23 ||
          Number(value.slice(14, 16)) > 59 ||
          Number(value.slice(17, 19) || 0) > 59))
    )
      throw Error("日期或时间无效");
    return value;
  }
  const fingerprint = (t) =>
    JSON.stringify([
      t.date,
      t.category,
      t.subcategory || "",
      t.amount,
      t.currency || "CNY",
      t.type || "单次",
      t.purpose || "其他",
      t.description || "",
      t.projectId || "",
      t.expenseCategoryId || "",
      t.transferId || "",
    ]);
  function rows(book) {
    const legacyDebtPaths = new Set(
      accounts(book)
        .filter((a) => a.node.isDebt)
        .map((a) =>
          JSON.stringify([a.path[0], a.path.length > 1 ? a.path.at(-1) : ""]),
        ),
    );
    return book.transactions.map((t) => ({
      记录ID: t.id,
      日期: t.date,
      账户ID: t.accountId || "",
      类别: t.category,
      子类别: t.subcategory || "",
      金额: t.amount,
      货币类型: t.currency || book.settings.baseCurrency,
      类型: t.type || "单次",
      用途分类: t.purpose || "其他",
      描述: t.description || "",
      项目ID: t.projectId || "",
      消费分类ID: t.expenseCategoryId || "",
      内部转账ID: t.transferId || "",
      金额语义:
        !t.accountId &&
        legacyDebtPaths.has(JSON.stringify([t.category, t.subcategory || ""]))
          ? "历史余额变动"
          : "收支",
    }));
  }
  function prepare(book, input) {
    if (!Array.isArray(input) || input.length > 50000)
      throw Error("单次导入最多 50,000 行");
    const available = accounts(book),
      ids = new Map(book.transactions.map((t) => [t.id, t])),
      seen = new Set(book.transactions.map(fingerprint));
    const plan = {
      source: JSON.stringify(book),
      accepted: [],
      suspected: [],
      duplicates: [],
      errors: [],
      total: input.length,
    };
    input.forEach((r, i) => {
      try {
        if (text(r["内部转账ID"]) || text(r["用途分类"]) === "内部转账")
          throw Error("内部转账必须保留配对信息，请使用完整 JSON 导入");
        if (text(r["金额语义"]) === "历史余额变动")
          throw Error("历史负债余额记录的金额语义不同，请使用完整 JSON 导入");
        const amountRaw = r["金额"];
        if (
          amountRaw === null ||
          amountRaw === undefined ||
          text(amountRaw) === "" ||
          !Number.isFinite(Number(amountRaw)) ||
          Math.abs(Number(amountRaw)) > 1e12
        )
          throw Error("金额必须为有限数字，绝对值不超过一万亿");
        const accountId = text(r["账户ID"]);
        const matches = available.filter((a) =>
          accountId
            ? a.node.id === accountId
            : a.path[0] === text(r["类别"]) &&
              (a.path.length === 1
                ? !text(r["子类别"])
                : a.path.at(-1) === text(r["子类别"])),
        );
        if (matches.length !== 1)
          throw Error("无法唯一匹配资金账户，请填写账户ID或修正类别");
        const a = matches[0];
        const t = {
          id:
            text(r["记录ID"]) ||
            "import-" + Date.now().toString(36) + "-" + ++sequence,
          date: date(r["日期"]),
          category: a.path[0],
          subcategory: a.path.length > 1 ? a.path.at(-1) : "",
          accountId: a.node.id,
          amount: Number(amountRaw),
          currency: text(r["货币类型"]) || book.settings.baseCurrency,
          type: text(r["类型"]) || "单次",
          purpose: text(r["用途分类"]) || "其他",
          description: text(r["描述"]),
          projectId: text(r["项目ID"]) || null,
          expenseCategoryId: text(r["消费分类ID"]) || null,
        };
        t.includeTime = t.date.includes("T");
        if (
          Object.values(t).some((v) => typeof v === "string" && v.length > 2000)
        )
          throw Error("文本过长");
        rate(book, t.currency);
        rate(book, a.node.currency || book.settings.baseCurrency);
        if (text(r["项目与消费分类"]) && !t.projectId)
          throw Error(
            "旧表仅含项目名称，不能安全恢复归属，请使用新版 Excel 或完整 JSON",
          );
        if (t.projectId) {
          const p = (book.expenseProjects || []).find(
            (p) => p.id === t.projectId,
          );
          if (
            !p ||
            (t.expenseCategoryId &&
              !p.categories.some((c) => c.id === t.expenseCategoryId))
          )
            throw Error("项目或消费分类不存在，请先导入完整 JSON");
        } else if (t.expenseCategoryId) throw Error("消费分类缺少所属项目");
        const key = fingerprint(t);
        const existing = ids.get(t.id);
        if (existing) {
          if (fingerprint(existing) !== key)
            throw Error("记录ID内容冲突，请人工核对");
          plan.duplicates.push({ row: i + 2, transaction: t });
          return;
        }
        const item = { row: i + 2, transaction: t };
        if (seen.has(key)) plan.suspected.push(item);
        else plan.accepted.push(item);
        ids.set(t.id, t);
        seen.add(key);
      } catch (e) {
        plan.errors.push({ row: i + 2, message: e.message });
      }
    });
    return plan;
  }
  function apply(book, plan, includeSuspected = false) {
    if (JSON.stringify(book) !== plan.source)
      throw Error("账本已有变化，请重新预览");
    if (plan.errors.length) throw Error("请先修正所有错误行");
    const next = clone(book),
      map = new Map(accounts(next).map((a) => [a.node.id, a.node]));
    for (const { transaction: t } of [
      ...plan.accepted,
      ...(includeSuspected ? plan.suspected : []),
    ]) {
      next.transactions.push(clone(t));
      const a = map.get(t.accountId);
      a.balance +=
        ((a.isDebt ? -t.amount : t.amount) * rate(next, t.currency)) /
        rate(next, a.currency || next.settings.baseCurrency);
      if (!Number.isFinite(a.balance)) throw Error("余额超出范围");
    }
    return next;
  }
  return { accounts, date, rows, prepare, apply };
});
