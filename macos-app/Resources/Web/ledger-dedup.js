(function (root, factory) {
  const api = factory();
  if (typeof module === "object" && module.exports) module.exports = api;
  root.AssetTrackerDedup = api;
})(globalThis, function () {
  "use strict";

  // Confidence labels describe evidence, not probabilities. This module only
  // reports pairs; callers decide what to retain and never get a deletion plan.
  const rank = { conflict: 0, exact: 1, high: 2, possible: 3 };
  const text = (value) => String(value ?? "").normalize("NFKC").trim();
  const folded = (value) => text(value).replace(/\s+/gu, " ").toLowerCase();
  const key = (parts) => JSON.stringify(parts);
  const genericDescriptions = new Set(["", "消费", "支出", "收入", "付款", "支付", "收款", "转账", "其他", "无", "未知", "--", "-", "n/a", "na", "null"]);
  const unknownProviders = new Set(["", "statement", "unknown"]);
  const RULE_VERSION = "2026-10-03.1";
  const bankProviders = new Set(["icbc", "ocbc"]);
  const nestedProviders = ["wechat", "alipay", "icbc", "ocbc"];
  const relatedWindowMs = 2 * 60 * 60 * 1000;

  function accountResolver(book) {
    const labels = new Map(), ids = new Map(), legacyBindings = new Map();
    function walk(nodes, path = []) {
      for (const node of Object.values(nodes || {})) {
        if (!node || typeof node !== "object") continue;
        const next = [...path, folded(node.name)];
        if (node.children && Object.keys(node.children).length) {
          walk(node.children, next);
        } else {
          const label = key([next[0], next.length > 1 ? next.at(-1) : ""]);
          if (!labels.has(label)) labels.set(label, []);
          // Ambiguous leaves stay ambiguous, including leaves without IDs.
          labels.get(label).push(text(node.id));
          if (text(node.id)) ids.set(text(node.id), (ids.get(text(node.id)) || 0) + 1);
          for (const id of new Set([text(node.id), text(node.sourceCategoryId)].filter(Boolean))) {
            if (!legacyBindings.has(id)) legacyBindings.set(id, []);legacyBindings.get(id).push(text(node.id));
          }
        }
      }
    }
    walk(book?.categories);
    return (transaction) => {
      const explicitId = text(transaction.accountId);
      if (explicitId) return !book?.categories || ids.get(explicitId) === 1 ? explicitId : null;
      const legacyId = text(transaction.sourceCategoryId);
      if (legacyId) {
        const bindings = legacyBindings.get(legacyId);
        return bindings?.length === 1 && ids.get(bindings[0]) === 1 ? bindings[0] : null;
      }
      const matches = labels.get(key([folded(transaction.category), folded(transaction.subcategory)]));
      return matches?.length === 1 && matches[0] ? matches[0] : null;
    };
  }

  function sourcesOf(t) {
    const sources = new Map();
    const add = (provider, id, kind) => {
      provider = folded(provider);id = text(id);
      if (unknownProviders.has(provider) || !id) return;
      const sourceKey = key([provider, id]), previous = sources.get(sourceKey);
      sources.set(sourceKey, { provider, id, key: sourceKey, kind: previous?.kind === "derived" ? "derived" : kind });
    };
    for (const provider of nestedProviders) {
      if (t[provider] && typeof t[provider] === "object") add(provider, t[provider].transactionId, bankProviders.has(provider) ? "derived" : "real");
    }
    if (t.sourceIdentity && typeof t.sourceIdentity === "object") {
      const s = t.sourceIdentity, derived = /derived|hash|fingerprint/.test(folded(s.kind));
      add(s.provider, s.id, derived ? "derived" : "real");
    }
    return [...sources.values()];
  }

  function bankOf(t) {
    const providers = [...bankProviders].filter(provider => t[provider] && typeof t[provider] === "object");
    if (providers.length !== 1) return null;
    const provider = providers[0], metadata = t[provider];
    return { provider, metadata, fingerprint: text(metadata.accountFingerprint),
      balance: Number.isSafeInteger(metadata.bankBalanceCents) ? metadata.bankBalanceCents : null,
      page: Number.isSafeInteger(metadata.sourcePage) && metadata.sourcePage > 0 ? metadata.sourcePage : null,
      row: Number.isSafeInteger(metadata.sourceRow) && metadata.sourceRow > 0 ? metadata.sourceRow : null,
      sourceId: text(metadata.transactionId) };
  }

  function parseDate(value) {
    const raw = text(value);
    const match = /^(\d{4})[-/](\d{1,2})[-/](\d{1,2})(?:[T ](\d{2}):(\d{2})(?::(\d{2})(?:\.(\d{1,3}))?)?(Z|[+-]\d{2}:?\d{2})?)?$/i.exec(raw);
    if (!match) return null;
    const year = +match[1], month = +match[2], day = +match[3];
    if (year < 100 || month < 1 || month > 12 || day < 1 || day > 31) return null;
    const localDay = `${match[1]}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
    const midnight = Date.UTC(year, month - 1, day);
    if (new Date(midnight).toISOString().slice(0, 10) !== localDay) return null;
    const timed = match[4] !== undefined;
    const hours = +(match[4] || 0), minutes = +(match[5] || 0), seconds = +(match[6] || 0);
    if (hours > 23 || minutes > 59 || seconds > 59) return null;
    const fraction = match[7] || "";
    let start = midnight + (hours * 3600 + minutes * 60 + seconds) * 1000 + +(fraction.padEnd(3, "0") || 0);
    const zone = match[8] || "";
    if (zone && zone.toUpperCase() !== "Z") {
      const zoneHours = +zone.slice(1, 3), zoneMinutes = +zone.slice(-2);
      if (zoneHours > 23 || zoneMinutes > 59) return null;
      start -= (zone[0] === "+" ? 1 : -1) * (zoneHours * 60 + zoneMinutes) * 60000;
    }
    const precision = !timed ? 86400000 : match[6] === undefined ? 60000 : !fraction ? 1000 : 10 ** (3 - fraction.length);
    return {
      localDay,
      day: zone ? new Date(start).toISOString().slice(0, 10) : localDay,
      start, end: start + precision, timed, zoned: Boolean(zone),
    };
  }

  function normalize(transaction, resolveAccount, book) {
    const t = transaction && typeof transaction === "object" ? transaction : {};
    const rawAmount = t.amount;
    const amount = (typeof rawAmount === "number" || (typeof rawAmount === "string" && text(rawAmount) !== ""))
      ? Number(rawAmount) : NaN;
    const sources = sourcesOf(t), bank = bankOf(t);
    const metadata = bank?.metadata || nestedProviders.map(provider => t[provider]).find(value => value && typeof value === "object");
    const merchant = metadata ? [metadata.counterparty, metadata.product].map(text).filter(value => value && value !== "/").join(" · ") : "";
    return {
      transaction: t,
      id: text(t.id),
      sources, bank,
      date: parseDate(t.date),
      account: resolveAccount(t),
      amount,
      currency: text(t.currency || book?.settings?.baseCurrency || "CNY").toUpperCase(),
      description: folded(merchant || t.description),
      rawDescription: folded(t.description),
      flowText: folded([t.description, t.purpose, metadata?.transactionType, metadata?.counterparty, metadata?.product].filter(Boolean).join(" ")),
    };
  }

  function dateRelation(a, b) {
    if (!a || !b) return { sameDay: false, sameTime: false, uncertainZone: false };
    const sameDay = a.zoned && b.zoned ? a.day === b.day
      : a.localDay === b.localDay;
    const uncertainZone = a.timed && b.timed && a.zoned !== b.zoned;
    return {
      sameDay,
      sameTime: !a.timed || !b.timed || (!uncertainZone && a.start < b.end && b.start < a.end),
      uncertainZone,
    };
  }

  function smallMerchantDifference(a, b) {
    // One character of OCR/typing variation is only supporting evidence. Short
    // generic labels (e.g. 午餐 vs 早餐) and unrelated merchants do not match.
    const left = Array.from(a), right = Array.from(b);
    if (Math.min(left.length, right.length) < 3 || Math.max(left.length, right.length) > 256 || Math.abs(left.length - right.length) > 1) return false;
    let i = 0, j = 0, changes = 0;
    while (i < left.length && j < right.length) {
      if (left[i] === right[j]) { i++; j++; continue; }
      if (++changes > 1) return false;
      if (left.length >= right.length) i++;
      if (right.length >= left.length) j++;
    }
    return changes + (left.length - i) + (right.length - j) <= 1;
  }

  function descriptiveDifferences(a, b) {
    const differences = [];
    if (a.description !== b.description) differences.push("商户或描述不同");
    for (const [field, label] of [["category", "账户类别"], ["subcategory", "账户子类别"],
      ["purpose", "用途分类"], ["projectId", "项目归属"], ["expenseCategoryId", "消费分类"],
      ["transferId", "转账关联"], ["type", "记录类型"]]) {
      if (folded(a.transaction[field]) !== folded(b.transaction[field])) differences.push(`${label}不同`);
    }
    if (a.date && b.date && a.date.timed !== b.date.timed) differences.push("日期时间精度不同，一方仅记录日期");
    return differences;
  }

  function amountCents(amount) {
    const cents = Math.round(amount * 100);
    return Number.isFinite(amount) && Number.isSafeInteger(cents) && Math.abs(amount * 100 - cents) < 0.000001 ? cents : null;
  }
  function bankRowKey(record) {
    const b = record.bank;
    return b?.fingerprint && b.sourceId ? key([b.provider, b.fingerprint, record.currency, b.sourceId]) : null;
  }
  function sameBankEndpoint(a, b) {
    return bankRowKey(a) === bankRowKey(b) && a.amount === b.amount && a.currency === b.currency
      && a.date?.start === b.date?.start && a.date?.end === b.date?.end && a.date?.zoned === b.date?.zoned
      && a.transaction.includeTime !== false && a.bank.balance === b.bank.balance
      && a.bank.page === b.bank.page && a.bank.row === b.bank.row
      && text(a.bank.metadata.valueDate) === text(b.bank.metadata.valueDate)
      && folded(a.bank.metadata.product) === folded(b.bank.metadata.product);
  }
  function bankRowEvidence(record) {
    return { transactionId: record.id, date: record.transaction.date, amount: record.amount, currency: record.currency,
      bankBalanceCents: record.bank.balance, sourcePage: record.bank.page, sourceRow: record.bank.row };
  }

  function createContext(book) {
    const resolveAccount = accountResolver(book), references = new Map();
    const audits = book?.importAudits;
    const context = { book, resolveAccount, references, auditRows: 0 };
    if (!Array.isArray(audits) || !audits.some(audit => bankProviders.has(audit?.provider))) return context;
    const existing = new Map();
    for (const t of book?.transactions || []) {
      const id = text(t?.id);if (!existing.has(id)) existing.set(id, []);existing.get(id).push(t);
    }
    audits.forEach((audit, auditIndex) => {
      if (!bankProviders.has(audit?.provider) || !Array.isArray(audit.items)) return;
      const rows = [], rowIds = new Map(), coordinates = new Map();
      let incomplete = false;
      for (const item of audit.items) {
        const sourceId = text(item?.sourceId || item?.candidate?.id || item?.record?.id);
        const stored = existing.get(sourceId);
        const t = item?.candidate?.[audit.provider] ? item.candidate : item?.record?.[audit.provider] ? item.record : stored?.length === 1 ? stored[0] : null;
        if (!t || !t[audit.provider] || !sourceId || sourceId !== text(t.id)) { incomplete = true;continue; }
        const record = normalize(t, resolveAccount, book), b = record.bank;
        context.auditRows++;
        if (!b || b.provider !== audit.provider || !b.page || !b.row) { incomplete = true;continue; }
        const known = item.record;
        const recordAgrees = !known || ["date", "amount", "currency"].every(field => known[field] === undefined || known[field] === t[field]);
        const valid = Boolean(bankRowKey(record) && b.balance !== null && amountCents(record.amount) !== null
          && record.date?.timed && t.includeTime !== false && /^[A-Z]{3}$/.test(text(t.currency)) && recordAgrees);
        const entry = { record, valid, decision: item.decision };
        rows.push(entry);
        rowIds.set(bankRowKey(record), (rowIds.get(bankRowKey(record)) || 0) + 1);
        const coordinate = key([b.page, b.row]);coordinates.set(coordinate, (coordinates.get(coordinate) || 0) + 1);
      }
      // An unlocatable row can hide an intervening posting. Do not infer where
      // it belongs or fill its fields from an unrelated statement.
      if (incomplete) return;
      rows.sort((a, b) => a.record.bank.page - b.record.bank.page || a.record.bank.row - b.record.bank.row);
      const pages = new Map();
      rows.forEach((entry, position) => {
        const b = entry.record.bank;entry.position = position;
        entry.valid = entry.valid && rowIds.get(bankRowKey(entry.record)) === 1 && coordinates.get(key([b.page, b.row])) === 1;
        if (!pages.has(b.page)) pages.set(b.page, []);pages.get(b.page).push(b.row);
      });
      const verifiedPages = new Set(), pageClaims = new Map();
      for (const check of Array.isArray(audit.verification) ? audit.verification : []) {
        if (!Number.isSafeInteger(check?.page) || !Number.isSafeInteger(check?.count) || check.count < 1) continue;
        if (!pageClaims.has(check.page)) pageClaims.set(check.page, []);pageClaims.get(check.page).push(check.count);
      }
      for (const [page, claims] of pageClaims) {
        const pageRows = pages.get(page);
        if (claims.length === 1 && pageRows?.length === claims[0] && pageRows.every((row, i) => row === i + 1)) verifiedPages.add(page);
      }
      const gapPrefix = [0];
      rows.forEach((entry, i) => {
        const current = entry.record.bank, previous = rows[i - 1]?.record.bank;
        const contiguous = !previous || (current.page === previous.page && current.row === previous.row + 1)
          || (current.page === previous.page + 1 && current.row === 1 && verifiedPages.has(previous.page) && verifiedPages.has(current.page));
        // Invalid intervening rows cannot disappear merely because a missing
        // account fingerprint puts them into another grouping bucket.
        const complete = entry.valid && (!i || rows[i - 1].valid);
        gapPrefix.push(gapPrefix[i] + (contiguous && complete ? 0 : 1));
      });
      const groups = new Map();
      for (const entry of rows) {
        const r = entry.record, groupKey = key([r.bank.provider, r.bank.fingerprint, r.currency]);
        if (!groups.has(groupKey)) groups.set(groupKey, []);groups.get(groupKey).push(entry);
      }
      for (const entries of groups.values()) {
        const group = { auditIndex, auditId: text(audit.id), provider: audit.provider, entries, rowBad: [0], linkBad: [0] };
        entries.forEach((entry, i) => {
          const r = entry.record, previous = entries[i - 1], p = previous?.record;
          const validLink = !previous || (entry.valid && previous.valid && r.date.zoned === p.date.zoned && r.date.start >= p.date.start
            && p.bank.balance + amountCents(r.amount) === r.bank.balance
            && gapPrefix[entry.position + 1] === gapPrefix[previous.position + 1]);
          group.rowBad.push(group.rowBad[i] + (entry.valid ? 0 : 1));
          group.linkBad.push(group.linkBad[i] + (validLink ? 0 : 1));
          const sourceKey = bankRowKey(r);
          if (sourceKey) { if (!references.has(sourceKey)) references.set(sourceKey, []);references.get(sourceKey).push({ group, position: i, record: r }); }
        });
      }
    });
    return context;
  }

  function bankChainEvidence(a, b, context) {
    const left = context.references.get(bankRowKey(a)) || [], right = context.references.get(bankRowKey(b)) || [];
    const paths = [];
    for (const x of left) for (const y of right) {
      if (x.group !== y.group || x.position === y.position || !sameBankEndpoint(a, x.record) || !sameBankEndpoint(b, y.record)) continue;
      const first = Math.min(x.position, y.position), last = Math.max(x.position, y.position), group = x.group;
      if (last - first < 2 || group.rowBad[last + 1] !== group.rowBad[first] || group.linkBad[last + 1] !== group.linkBad[first + 1]) continue;
      const earlier = group.entries[first].record, later = group.entries[last].record;
      if (later.date.start < earlier.date.end) continue;
      paths.push({ group, first, last });
    }
    if (paths.length !== 1) return null;
    const { group, first, last } = paths[0];
    return { type: "bank-balance-chain", provider: group.provider, auditIndex: group.auditIndex, auditId: group.auditId,
      intermediateCount: last - first - 1, balanceContinuityPassed: true,
      rows: group.entries.slice(first, last + 1).map(entry => ({ ...bankRowEvidence(entry.record), auditDecision: entry.decision || null })),
      limitation: "只支持这些是不同银行记账记录，不确认资金用途、交易对方身份或是否属于内部转账；依据为本账本保留的导入审计，未重新验证原文件。" };
  }

  function relatedEvidence(a, b, relation) {
    if (!Number.isFinite(a.amount) || !Number.isFinite(b.amount) || !a.amount || a.amount !== -b.amount || a.currency !== b.currency
        || !a.date || !b.date || !a.account || !b.account || relation.uncertainZone) return null;
    const timed = a.date.timed && b.date.timed;
    const apart = timed ? Math.abs(a.date.start - b.date.start) : null;
    if (timed ? apart > relatedWindowMs : !relation.sameDay) return null;
    const sharedTransfer = text(a.transaction.transferId) && text(a.transaction.transferId) === text(b.transaction.transferId);
    const transfer = /转账|汇款|汇入|汇出|提现|充值|transfer|remittance|withdrawal|top[ -]?up/i;
    const refund = /退款|退还|撤销|refund|reversal/i;
    const merchant = value => value.replace(/退款|退还|撤销|付款|支付|消费|refund|reversal|payment/gi, "").replace(/[\s\p{P}\p{S}]/gu, "");
    const leftMerchant = merchant(a.description), rightMerchant = merchant(b.description);
    const refundMatch = (refund.test(a.flowText) || refund.test(b.flowText)) && leftMerchant.length >= 2 && leftMerchant === rightMerchant && !genericDescriptions.has(leftMerchant);
    const transferMatch = a.account !== b.account && (sharedTransfer || transfer.test(a.flowText) || transfer.test(b.flowText));
    if (!transferMatch && !refundMatch) return null;
    return { type: "possible-funds-flow", relation: refundMatch ? "possible-refund" : "possible-transfer", amount: Math.abs(a.amount), currency: a.currency,
      sameAccount: a.account === b.account, secondsApart: apart === null ? null : apart / 1000, timeWindowHours: 2,
      sharedTransferId: sharedTransfer ? text(a.transaction.transferId) : null,
      limitation: "金额、方向、账户与文字只构成资金往来的候选联系，不确认资金用途、本人账户归属或内部转账；不能据此删除任何一边。" };
  }

  function explainNormalized(a, b, context) {
    const sameId = Boolean(a.id && a.id === b.id);
    const sharedSources = a.sources.flatMap(x => b.sources.filter(y => x.key === y.key).map(y => ({ ...x, kind: x.kind === "real" && y.kind === "real" ? "real" : "derived" })));
    const sameSource = sharedSources.some(s => s.kind === "real"), sameDerived = sharedSources.some(s => s.kind === "derived");
    const identity = sameId || sameSource || sameDerived;
    const relation = dateRelation(a.date, b.date);
    const differences = descriptiveDifferences(a, b);
    const result = (kind, reasons, level, evidence, extraDifferences = []) => ({ kind, ...(level ? { level } : {}), reasons, differences: [...extraDifferences, ...differences], ...(evidence ? { evidence } : {}) });
    const core = [];
    if (!Number.isFinite(a.amount) || !Number.isFinite(b.amount)) core.push("金额无效，无法核对");
    else if (a.amount !== b.amount) core.push(Math.sign(a.amount) !== Math.sign(b.amount) ? "收支方向不同" : "金额不同");
    if (a.currency !== b.currency) core.push("币种不同");
    if (a.account && b.account && a.account !== b.account) core.push("资金账户不同");
    if (!a.date || !b.date) core.push("日期无效，无法核对");
    else if (!relation.sameDay) core.push("交易日期不同");
    if (a.date?.timed && b.date?.timed && !relation.sameTime && !relation.uncertainZone) differences.push("交易时间不同，可能是当天的另一笔消费");
    if (relation.uncertainZone) differences.push("时区信息不完整，无法确认时间是否一致");

    if (identity) {
      const reason = sameSource ? "来源平台与真实交易号相同" : sameId ? "记录 ID 相同" : "导入行的派生指纹相同；派生 hash 不是银行真实流水号";
      if (a.date?.timed && b.date?.timed && !relation.sameTime && !relation.uncertainZone) core.push("同一身份的交易时间冲突");
      if (sameId && a.sources.length && b.sources.length && !sharedSources.length) core.push("同一记录 ID 的来源交易标识不同");
      if (sameId && !sameSource && !sameDerived && a.rawDescription !== b.rawDescription) core.push("同一记录 ID 的商户或描述已改变");
      if (a.bank && b.bank && a.bank.provider === b.bank.provider) {
        if (a.bank.fingerprint && b.bank.fingerprint && a.bank.fingerprint !== b.bank.fingerprint) core.push("同一身份的银行账户指纹冲突");
        if (a.bank.balance !== null && b.bank.balance !== null && a.bank.balance !== b.bank.balance) core.push("同一身份的账后余额冲突");
      }
      const evidence = { type: sameSource ? "real-source-identity" : sameId ? "record-identity" : "derived-source-fingerprint", sources: sharedSources };
      if (core.length) return result("duplicate", [reason, "相同标识但关键交易字段冲突，请核对原始账单"], "conflict", evidence, core);
      if (!a.account || !b.account || relation.uncertainZone) {
        return result("duplicate", [reason, !a.account || !b.account ? "无法唯一确认资金账户，需要人工核对" : "时间信息不足，需要人工核对"], "possible", evidence);
      }
      return result("duplicate", [reason, "金额、币种、资金账户与日期一致"], sameId || sameSource ? "exact" : "high", evidence);
    }

    const funds = relatedEvidence(a, b, relation);
    if (funds) return result("related", ["同币种、等额且收支方向相反", funds.relation === "possible-refund" ? "描述支持原付款与退款的可能对应" : "不同资金账户与转账文字支持资金往来的可能对应",
      "这是资金流联系，不是重复消费，不能作为删除依据"], "possible", funds);
    const comparableBank = a.bank && b.bank && a.bank.provider === b.bank.provider && a.bank.fingerprint && a.bank.fingerprint === b.bank.fingerprint
      && a.currency === b.currency && Number.isFinite(a.amount) && a.amount === b.amount && relation.sameDay;
    if (comparableBank && a.bank.balance !== null && b.bank.balance !== null) {
      if (a.bank.balance !== b.bank.balance) return result("distinct", ["同一银行账户、币种与金额，但账后余额不同", "账后余额支持不同银行记账记录；不确认资金用途"], null,
        { type: "different-bank-balances", provider: a.bank.provider, rows: [bankRowEvidence(a), bankRowEvidence(b)], limitation: "只支持记录不同，不确认资金用途、本人账户归属或是否属于内部转账。" });
      const chain = bankChainEvidence(a, b, context);
      if (chain) return result("distinct", [`完整导入审计中间有 ${chain.intermediateCount} 条记录，逐笔余额连续`, "相同账后余额可由中间收支解释，支持不同记账记录，应保留核对"], null, chain);
    }
    if (core.length || !a.account || !b.account) return result("unrelated", [!a.account || !b.account ? "账户尚不能唯一确认，不能据内容判定重复" : "关键财务字段不满足重复比较条件"], null, null, core);
    // Only independently supplied real IDs can prove distinct source events.
    // Different bank row hashes never supply this negative evidence.
    for (const provider of new Set(a.sources.filter(s => s.kind === "real").map(s => s.provider))) {
      const left = a.sources.filter(s => s.provider === provider && s.kind === "real"), right = b.sources.filter(s => s.provider === provider && s.kind === "real");
      if (left.length === 1 && right.length === 1 && left[0].id !== right[0].id) return result("distinct", ["同一来源平台具有不同真实交易号，支持独立交易记录"], null,
        { type: "different-real-order-ids", provider, leftId: left[0].id, rightId: right[0].id });
    }
    if (text(a.transaction.transferId) && text(b.transaction.transferId) && text(a.transaction.transferId) !== text(b.transaction.transferId)) return result("distinct", ["记录属于不同转账关联"], null, { type: "different-transfer-links" });
    const reasons = ["日期、金额、币种与资金账户一致"];
    let level = "high";
    if (genericDescriptions.has(a.description) || genericDescriptions.has(b.description)) {
      level = "possible";
      reasons.push("缺少具体商户或描述，仅凭同日同金额不能确认重复");
    } else if (a.description === b.description) {
      reasons.push("规范化后的商户或描述一致");
    } else if (smallMerchantDifference(a.description, b.description)) {
      level = "possible";
      reasons.push("商户或描述只有轻微差异，可能是识别差异，也可能是另一笔交易");
    } else return result("unrelated", ["同日同金额不足以对应不同商户或描述"], null);
    if (!relation.sameTime || relation.uncertainZone) {
      level = "possible";
      reasons.push(relation.uncertainZone ? "缺少统一时区依据" : "已知交易时间不同，应核对是否为重复消费");
    }
    if (a.sources.some(x => b.sources.some(y => x.provider !== y.provider && x.id === y.id))) {
      level = "possible";
      reasons.push("来源平台不同，相同交易号不能作为同一笔交易的依据");
    }
    if (a.sources.some(s => s.kind === "derived") || b.sources.some(s => s.kind === "derived")) reasons.push("银行派生行指纹不等于真实交易号，指纹不同不会单独排除重复");
    return result("duplicate", reasons, level);
  }

  function explainPair(candidate, existing, options = {}) {
    const context = createContext(options.book);
    return explainNormalized(normalize(candidate, context.resolveAccount, options.book), normalize(existing, context.resolveAccount, options.book), context);
  }
  function compare(candidate, existing, options = {}) {
    const result = explainPair(candidate, existing, options);
    return result.kind === "duplicate" ? result : null;
  }

  function bucketKeys(record) {
    if (!record.date || !record.account || !Number.isFinite(record.amount)) return [];
    return [...new Set([record.date.day, record.date.localDay])]
      .map(day => key([day, record.amount, record.currency, record.account]));
  }

  function bankBucketKeys(record) {
    if (!record.date || !record.bank?.fingerprint || !Number.isFinite(record.amount)) return [];
    return [...new Set([record.date.day, record.date.localDay])].map(day => key([day, record.bank.provider, record.bank.fingerprint, record.amount, record.currency]));
  }
  function relatedBucketKeys(record, opposite = false) {
    if (!record.date || !Number.isFinite(record.amount) || !record.amount) return [];
    const days = new Set([record.date.day, record.date.localDay]);
    if (opposite) for (const day of [...days]) {
      const midnight = Date.parse(day + "T00:00:00Z");
      for (const delta of [-1, 1]) days.add(new Date(midnight + delta * 86400000).toISOString().slice(0, 10));
    }
    return [...days].map(day => key([day, opposite ? -record.amount : record.amount, record.currency]));
  }

  function createIndex(transactions = [], options = {}) {
    if (!Array.isArray(transactions)) throw new TypeError("交易列表必须为数组");
    const context = createContext(options.book), resolveAccount = context.resolveAccount;
    const records = [], byId = new Map(), bySource = new Map(), buckets = new Map(), bankBuckets = new Map(), relatedBuckets = new Map();
    const stats = { comparisons: 0, auditRows: context.auditRows };
    const insert = (map, token, position) => {
      if (!token) return;
      if (!map.has(token)) map.set(token, []);
      map.get(token).push(position);
    };
    function add(transaction) {
      const record = normalize(transaction, resolveAccount, options.book), position = records.length;
      records.push(record);
      insert(byId, record.id, position);
      record.sources.forEach(source => insert(bySource, source.key, position));
      bucketKeys(record).forEach(token => insert(buckets, token, position));
      bankBucketKeys(record).forEach(token => insert(bankBuckets, token, position));
      relatedBucketKeys(record).forEach(token => insert(relatedBuckets, token, position));
      return position;
    }
    function collect(candidate, mode, { excludePosition, maxComparisons = Infinity } = {}) {
      const current = normalize(candidate, resolveAccount, options.book), positions = new Set();
      const append = values => (values || []).forEach(position => positions.add(position));
      if (mode === "related") relatedBucketKeys(current, true).forEach(token => append(relatedBuckets.get(token)));
      else if (mode === "distinct") bankBucketKeys(current).forEach(token => append(bankBuckets.get(token)));
      else {
        append(byId.get(current.id));
        current.sources.forEach(source => append(bySource.get(source.key)));
        bucketKeys(current).forEach(token => append(buckets.get(token)));
      }
      const matches = [];
      let comparisons = 0, truncated = false;
      for (const position of [...positions].sort((a, b) => a - b)) {
        if (position === excludePosition) continue;
        if (comparisons >= maxComparisons) { truncated = true;break; }
        comparisons++;
        stats.comparisons++;
        const record = records[position], result = explainNormalized(current, record, context);
        if (result.kind === mode && (mode !== "distinct" || ["bank-balance-chain", "different-bank-balances"].includes(result.evidence?.type))) {
          matches.push({ transactionId: record.transaction.id, transaction: record.transaction, ...result, position });
        }
      }
      Object.defineProperty(matches, "truncated", { value: truncated, enumerable: false });
      return matches;
    }
    const allMatches = (candidate, queryOptions) => collect(candidate, "duplicate", queryOptions);
    const allRelated = (candidate, queryOptions) => collect(candidate, "related", queryOptions);
    const allDistinct = (candidate, queryOptions) => collect(candidate, "distinct", queryOptions);
    function findMatches(candidate, queryOptions = {}) {
      // Draft review needs an exact total; only whole-ledger scans have a
      // default comparison budget. Keep exclusion without inheriting that cap.
      const all = allMatches(candidate, { excludePosition: queryOptions.excludePosition }).sort((a, b) => rank[a.level] - rank[b.level] || a.position - b.position);
      const matches = all.slice(0, 20).map(({ position, ...match }) => match);
      // Array metadata is non-enumerable to preserve ordinary array behavior.
      // Serializing callers can include total separately to make truncation clear.
      Object.defineProperty(matches, "total", { value: all.length, enumerable: false });
      return matches;
    }
    transactions.forEach(add);
    const explain = (left, right) => explainNormalized(normalize(left, resolveAccount, options.book), normalize(right, resolveAccount, options.book), context);
    return { add, findMatches, allMatches, allRelated, allDistinct, explainPair: explain, stats };
  }

  function findMatches(candidate, transactions, options = {}) {
    return createIndex(transactions, options).findMatches(candidate);
  }

  function scanKind(transactions, options, mode) {
    if (!Array.isArray(transactions)) throw new TypeError("交易列表必须为数组");
    const limit = options.limit ?? 10000;
    if (!Number.isSafeInteger(limit) || limit < 1) throw new TypeError("配对上限必须为正整数");
    const maxComparisons = options.maxComparisons ?? 200000;
    if (!Number.isSafeInteger(maxComparisons) || maxComparisons < 1) throw new TypeError("比较次数上限必须为正整数");
    const index = createIndex([], options), pairs = [];
    let truncated = false, truncatedReason = null;
    scanRows: for (let rightPosition = 0; rightPosition < transactions.length; rightPosition++) {
      const right = transactions[rightPosition], matches = index[mode](right, { maxComparisons: maxComparisons - index.stats.comparisons });
      for (let matchPosition = 0; matchPosition < matches.length; matchPosition++) {
        const match = matches[matchPosition];
        if (pairs.length === limit) { truncated = true;truncatedReason = "result-limit";break scanRows; }
        const { position, transactionId, transaction, ...explanation } = match;
        pairs.push({ leftId: match.transactionId, rightId: right.id, left: match.transaction, right,
          ...explanation,
          leftPosition: match.position, rightPosition });
      }
      if (matches.truncated) { truncated = true;truncatedReason = "comparison-budget";break; }
      index.add(right);
    }
    pairs.sort((a, b) => a.leftPosition - b.leftPosition || a.rightPosition - b.rightPosition);
    const result = pairs.map(({ leftPosition, rightPosition, ...pair }) => pair);
    Object.defineProperty(result, "truncated", { value: truncated, enumerable: false });
    Object.defineProperty(result, "truncatedReason", { value: truncatedReason, enumerable: false });
    Object.defineProperty(result, "stats", { value: { comparisons: index.stats.comparisons, maxComparisons }, enumerable: false });
    return result;
  }

  const scan = (transactions, options = {}) => scanKind(transactions, options, "allMatches");
  const scanRelated = (transactions, options = {}) => scanKind(transactions, options, "allRelated");
  const scanDistinct = (transactions, options = {}) => scanKind(transactions, options, "allDistinct");
  return { RULE_VERSION, compare, explainPair, findMatches, createIndex, scan, scanRelated, scanDistinct };
});
