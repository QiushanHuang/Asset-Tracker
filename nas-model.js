(function (root, factory) {
  const api = factory(
    typeof module === "object" && module.exports
      ? require("./ledger-import.js")
      : root.AssetTrackerImport,
  );
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AssetTrackerNASModel = api;
})(globalThis, function (I) {
  "use strict";
  const clone = (b) => JSON.parse(JSON.stringify(b));
  const C =
    typeof module === "object" && module.exports
      ? require("./nas-connection.js")
      : globalThis.AssetTrackerNASConnection;
  const id = () => C.id();
  function amount(value) {
    if (
      !/^\d+(\.\d{1,2})?$/.test(String(value)) ||
      !Number.isFinite(Number(value)) ||
      Number(value) <= 0 ||
      Number(value) > 1e12
    )
      throw Error("请输入大于 0 的金额，最多两位小数");
    return Number(value);
  }
  function account(book, { name, currency }) {
    name = String(name || "").trim();
    if (!name || name.length > 120) throw Error("账户名称需为 1–120 字");
    if (
      !["CNY", "USD", "SGD", "MYR", "HKD", "EUR", "JPY", "GBP"].includes(
        currency,
      )
    )
      throw Error("币种无效");
    if (I.accounts(book).some((a) => a.node.name === name))
      throw Error("账户名称已存在");
    const b = clone(book),
      key = id();
    b.categories[key] = { id: key, name, currency, balance: 0, isDebt: false };
    return b;
  }
  function entry(book, form) {
    const b = clone(book),
      a = I.accounts(b).find((a) => a.node.id === form.accountId);
    if (!a) throw Error("请选择资金账户");
    const value = amount(form.amount) * (form.direction === "expense" ? -1 : 1);
    const date = I.date(form.date),
      description = String(form.description || "").trim();
    if (description.length > 2000) throw Error("备注不能超过 2000 字");
    if (!["income", "expense"].includes(form.direction))
      throw Error("请选择收入或支出");
    const project = (b.expenseProjects || []).find(
      (p) => p.id === form.projectId,
    );
    if (
      (form.projectId && !project) ||
      (form.expenseCategoryId &&
        !project?.categories.some((c) => c.id === form.expenseCategoryId))
    )
      throw Error("项目或分类不存在");
    b.transactions.push({
      id: id(),
      date,
      category: a.path[0],
      subcategory: a.path.length > 1 ? a.path.at(-1) : "",
      accountId: a.node.id,
      amount: value,
      currency: a.node.currency || b.settings.baseCurrency,
      type: "单次",
      purpose: "其他",
      description,
      projectId: form.projectId || null,
      expenseCategoryId: form.expenseCategoryId || null,
    });
    a.node.balance = Number(
      (a.node.balance + (a.node.isDebt ? -value : value)).toPrecision(15),
    );
    return b;
  }
  function transfer(book, form) {
    const b = clone(book),
      a = I.accounts(b).find((a) => a.node.id === form.from),
      z = I.accounts(b).find((a) => a.node.id === form.to);
    if (!a || !z || a.node.id === z.node.id) throw Error("请选择两个不同账户");
    if (a.node.isDebt || z.node.isDebt) throw Error("转账目前仅支持非负债账户");
    if (a.node.currency !== z.node.currency)
      throw Error("当前仅支持同币种转账，请分别记录换汇事实");
    const value = amount(form.amount),
      date = I.date(form.date),
      transferId = id();
    for (const [node, signed] of [
      [a, -value],
      [z, value],
    ]) {
      node.node.balance = Number((node.node.balance + signed).toPrecision(15));
      b.transactions.push({
        id: id(),
        transferId,
        date,
        category: node.path[0],
        subcategory: node.path.length > 1 ? node.path.at(-1) : "",
        accountId: node.node.id,
        amount: signed,
        currency: node.node.currency,
        type: "单次",
        purpose: "内部转账",
        description: "内部转账",
      });
    }
    return b;
  }
  function remove(book, transactionId) {
    const b = clone(book),
      target = b.transactions.find((t) => t.id === transactionId);
    if (!target) throw Error("记录不存在");
    const removed = b.transactions.filter(
      (t) =>
        t.id === transactionId ||
        (target.transferId && t.transferId === target.transferId),
    );
    const list = I.accounts(b);
    for (const t of removed) {
      const candidates = list.filter((a) =>
        t.accountId
          ? a.node.id === t.accountId
          : a.path[0] === t.category &&
            (a.path.length === 1
              ? !t.subcategory
              : a.path.at(-1) === t.subcategory),
      );
      if (candidates.length !== 1)
        throw Error("历史记录无法唯一匹配账户，请先在原本地账本核对");
      const a = candidates[0].node;
      if (
        (a.currency || b.settings.baseCurrency) !==
        (t.currency || b.settings.baseCurrency)
      )
        throw Error("历史跨币种记录缺少原始换算事实，请在原账本核对后修改");
      const recordedDelta = t.accountId && a.isDebt ? -t.amount : t.amount;
      a.balance = Number((a.balance - recordedDelta).toPrecision(15));
    }
    const ids = new Set(removed.map((t) => t.id));
    b.transactions = b.transactions.filter((t) => !ids.has(t.id));
    return b;
  }
  function edit(book, transactionId, form) {
    const prior = book.transactions.find((t) => t.id === transactionId);
    if (!prior) throw Error("记录不存在");
    if (prior.transferId) throw Error("转账请整组删除后重新记录");
    if (!prior.accountId && I.accounts(book).some(a => a.node.isDebt && a.path[0] === prior.category && a.path.at(-1) === (prior.subcategory || prior.category))) {
      throw Error('历史负债记录采用旧余额记法，请核对并迁移后再修改');
    }
    const nextForm = { ...form };
    if (prior.date.includes("T") && form.date.length === 10)
      nextForm.date += prior.date.slice(10);
    const b = entry(remove(book, transactionId), nextForm);
    b.transactions[b.transactions.length - 1] = {
      ...prior,
      ...b.transactions[b.transactions.length - 1],
      id: transactionId,
      includeTime: nextForm.date.includes("T"),
    };
    return b;
  }
  function household(ledgers, selected) {
    const ids = new Set(selected),
      result = {};
    for (const l of ledgers) {
      if (l.kind === "personal" || !ids.has(l.id)) continue;
      for (const [currency, v] of Object.entries(l.summary)) {
        const total = (result[currency] ??= {
          income: 0,
          expense: 0,
          count: 0,
        });
        total.income += v.income;
        total.expense += v.expense;
        total.count += v.count;
      }
    }
    for (const v of Object.values(result)) {
      v.income = Math.round(v.income * 100) / 100;
      v.expense = Math.round(v.expense * 100) / 100;
    }
    return result;
  }
  return { entry, transfer, account, household, amount, edit, remove };
});
